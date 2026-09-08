import "server-only";

import { getSqlite, sqliteTransaction } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { calculateAssignmentAnalytics } from "./assignment-analytics";
import type { RosterRow } from "./roster-csv";
import { now } from "./server";

export type TeacherMode = "personal" | "school";
export type TeachingClassRecord = {
  id: string; name: string; grade: string; subject: string; schoolYear: string;
  archived: number; studentCount: number; createdAt: string; updatedAt: string;
};

const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function cleanText(value: unknown, label: string, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum || /[\u0000-\u001f]/.test(text)) throw new Error(`${label}格式无效`);
  return text;
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function makeAssignmentCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((value) => codeAlphabet[value % codeAlphabet.length]).join("");
}

export async function getTeacherMode(ownerId: string): Promise<TeacherMode> {
  await ensureDatabase();
  const row = getSqlite().prepare("SELECT teacher_mode AS mode FROM app_settings WHERE owner_id = ?").get(ownerId) as { mode: string } | undefined;
  return row?.mode === "school" ? "school" : "personal";
}

export async function setTeacherMode(ownerId: string, mode: TeacherMode) {
  await ensureDatabase();
  getSqlite().prepare(
    `INSERT INTO app_settings (owner_id, teacher_mode, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET teacher_mode = excluded.teacher_mode, updated_at = excluded.updated_at`,
  ).run(ownerId, mode, now());
  return { mode };
}

export async function listTeachingClasses(ownerId: string) {
  await ensureDatabase();
  return getSqlite().prepare(
    `SELECT c.id, c.name, c.grade, c.subject, c.school_year AS schoolYear, c.archived,
       c.created_at AS createdAt, c.updated_at AS updatedAt, COUNT(cs.student_id) AS studentCount
     FROM teaching_classes c LEFT JOIN class_students cs ON cs.class_id = c.id
     WHERE c.owner_id = ? GROUP BY c.id ORDER BY c.archived, c.updated_at DESC`,
  ).all(ownerId) as TeachingClassRecord[];
}

export async function createTeachingClass(ownerId: string, input: { name?: unknown; grade?: unknown; subject?: unknown; schoolYear?: unknown }) {
  await ensureDatabase();
  const name = cleanText(input.name, "班级名称", 60);
  const grade = cleanText(input.grade, "年级", 30);
  const subject = cleanText(input.subject ?? "数学", "学科", 30);
  const schoolYear = cleanText(input.schoolYear, "学年", 20);
  const id = crypto.randomUUID();
  const timestamp = now();
  try {
    getSqlite().prepare(
      `INSERT INTO teaching_classes (id, owner_id, name, grade, subject, school_year, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, ownerId, name, grade, subject, schoolYear, timestamp, timestamp);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new Error("同一学年已有同名班级");
    throw error;
  }
  return { id, name, grade, subject, schoolYear, archived: 0, studentCount: 0, createdAt: timestamp, updatedAt: timestamp } satisfies TeachingClassRecord;
}

export async function getTeachingClass(ownerId: string, classId: string) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const teachingClass = sqlite.prepare(
    `SELECT id, name, grade, subject, school_year AS schoolYear, archived, created_at AS createdAt, updated_at AS updatedAt
     FROM teaching_classes WHERE id = ? AND owner_id = ?`,
  ).get(classId, ownerId) as Omit<TeachingClassRecord, "studentCount"> | undefined;
  if (!teachingClass) throw new Error("班级不存在");
  const students = sqlite.prepare(
    `SELECT s.id, s.student_no AS studentNo, s.name, cs.seat_number AS seatNumber, cs.joined_at AS joinedAt
     FROM class_students cs JOIN students s ON s.id = cs.student_id
     WHERE cs.class_id = ? ORDER BY CASE WHEN cs.seat_number IS NULL THEN 1 ELSE 0 END, cs.seat_number, s.student_no`,
  ).all(classId) as Array<{ id: string; studentNo: string; name: string; seatNumber: string | null; joinedAt: string }>;
  return { ...teachingClass, studentCount: students.length, students };
}

export async function importClassRoster(ownerId: string, classId: string, rows: RosterRow[]) {
  await ensureDatabase();
  if (!rows.length) throw new Error("名单中没有学生");
  const timestamp = now();
  sqliteTransaction((transaction) => {
    if (!transaction.prepare("SELECT 1 FROM teaching_classes WHERE id = ? AND owner_id = ?").get(classId, ownerId)) throw new Error("班级不存在");
    const findStudent = transaction.prepare("SELECT id FROM students WHERE owner_id = ? AND student_no = ?");
    const insertStudent = transaction.prepare("INSERT INTO students (id, owner_id, student_no, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    const updateStudent = transaction.prepare("UPDATE students SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?");
    const linkStudent = transaction.prepare(
      `INSERT INTO class_students (class_id, student_id, seat_number, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(class_id, student_id) DO UPDATE SET seat_number = excluded.seat_number`,
    );
    rows.forEach((row) => {
      const existing = findStudent.get(ownerId, row.studentNo) as { id: string } | undefined;
      const studentId = existing?.id ?? crypto.randomUUID();
      if (existing) updateStudent.run(row.name, timestamp, studentId, ownerId);
      else insertStudent.run(studentId, ownerId, row.studentNo, row.name, timestamp, timestamp);
      linkStudent.run(classId, studentId, row.seatNumber, timestamp);
    });
    transaction.prepare("UPDATE teaching_classes SET updated_at = ? WHERE id = ?").run(timestamp, classId);
  });
  const studentCount = (getSqlite().prepare("SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?").get(classId) as { count: number }).count;
  return { imported: rows.length, studentCount };
}

export async function removeStudentFromClass(ownerId: string, classId: string, studentId: string) {
  await ensureDatabase();
  const result = getSqlite().prepare(
    `DELETE FROM class_students WHERE class_id = ? AND student_id = ?
       AND EXISTS (SELECT 1 FROM teaching_classes WHERE id = ? AND owner_id = ?)`,
  ).run(classId, studentId, classId, ownerId);
  if (!result.changes) throw new Error("学生或班级不存在");
  return { removed: true };
}

export async function listAssignments(ownerId: string) {
  await ensureDatabase();
  return getSqlite().prepare(
    `SELECT a.id, a.paper_id AS paperId, a.title, a.assignment_code AS assignmentCode, a.status,
       a.due_at AS dueAt, a.total_score AS totalScore, a.created_at AS createdAt, a.updated_at AS updatedAt,
       COUNT(DISTINCT ac.class_id) AS classCount, COUNT(DISTINCT s.id) AS studentCount,
       COUNT(DISTINCT CASE WHEN s.status = 'graded' THEN s.id END) AS gradedCount,
       GROUP_CONCAT(DISTINCT c.name) AS classNames
     FROM assignments a LEFT JOIN assignment_classes ac ON ac.assignment_id = a.id
       LEFT JOIN teaching_classes c ON c.id = ac.class_id LEFT JOIN submissions s ON s.assignment_id = a.id
     WHERE a.owner_id = ? GROUP BY a.id ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, a.updated_at DESC`,
  ).all(ownerId) as Array<{
    id: string; paperId: string; title: string; assignmentCode: string; status: string; dueAt: string | null;
    totalScore: number; createdAt: string; updatedAt: string; classCount: number; studentCount: number; gradedCount: number; classNames: string | null;
  }>;
}

export async function createAssignment(ownerId: string, input: { paperId?: unknown; title?: unknown; classIds?: unknown; dueAt?: unknown }) {
  await ensureDatabase();
  const paperId = cleanText(input.paperId, "试卷", 100);
  const title = cleanText(input.title, "作业名称", 120);
  if (!Array.isArray(input.classIds) || !input.classIds.length || input.classIds.length > 20 || input.classIds.some((id) => typeof id !== "string" || !id.trim())) throw new Error("请选择要布置的班级");
  const classIds = Array.from(new Set(input.classIds.map((id) => String(id).trim())));
  let dueAt: string | null = null;
  if (typeof input.dueAt === "string" && input.dueAt.trim()) {
    const parsed = new Date(input.dueAt);
    if (Number.isNaN(parsed.valueOf())) throw new Error("截止时间无效");
    dueAt = parsed.toISOString();
  }
  const sqlite = getSqlite();
  if (!sqlite.prepare("SELECT 1 FROM papers WHERE id = ? AND owner_id = ?").get(paperId, ownerId)) throw new Error("试卷不存在");
  const placeholders = classIds.map(() => "?").join(",");
  const classCount = (sqlite.prepare(`SELECT COUNT(*) AS count FROM teaching_classes WHERE owner_id = ? AND archived = 0 AND id IN (${placeholders})`).get(ownerId, ...classIds) as { count: number }).count;
  if (classCount !== classIds.length) throw new Error("所选班级不存在或已归档");
  const items = sqlite.prepare(
    `SELECT pi.question_id AS questionId, pi.position, pi.score, q.number, q.type, q.stem,
       q.options_json AS optionsJson, q.answer, q.analysis,
       COALESCE((SELECT GROUP_CONCAT(t.name, char(31)) FROM question_tags qt JOIN tags t ON t.id = qt.tag_id WHERE qt.question_id = q.id), '') AS tagsText
     FROM paper_items pi JOIN questions q ON q.id = pi.question_id WHERE pi.paper_id = ? ORDER BY pi.position`,
  ).all(paperId) as Array<{ questionId: string; position: number; score: number; number: string; type: string; stem: string; optionsJson: string | null; answer: string; analysis: string; tagsText: string }>;
  if (!items.length) throw new Error("试卷中没有题目");
  const id = crypto.randomUUID();
  const timestamp = now();
  let assignmentCode = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = makeAssignmentCode();
    if (!sqlite.prepare("SELECT 1 FROM assignments WHERE assignment_code = ?").get(candidate)) { assignmentCode = candidate; break; }
  }
  if (!assignmentCode) throw new Error("暂时无法生成作业码，请重试");
  const normalizedItems = items.map((item) => ({ ...item, maxScore: item.score > 0 ? item.score : 1, tags: item.tagsText ? item.tagsText.split(String.fromCharCode(31)) : [] }));
  const totalScore = normalizedItems.reduce((sum, item) => sum + item.maxScore, 0);
  sqliteTransaction((transaction) => {
    transaction.prepare(
      `INSERT INTO assignments (id, owner_id, paper_id, title, assignment_code, status, due_at, total_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).run(id, ownerId, paperId, title, assignmentCode, dueAt, totalScore, timestamp, timestamp);
    const addClass = transaction.prepare("INSERT INTO assignment_classes (assignment_id, class_id) VALUES (?, ?)");
    classIds.forEach((classId) => addClass.run(id, classId));
    const addItem = transaction.prepare("INSERT INTO assignment_items (assignment_id, question_id, position, max_score, snapshot_json) VALUES (?, ?, ?, ?, ?)");
    normalizedItems.forEach((item) => addItem.run(id, item.questionId, item.position, item.maxScore, JSON.stringify({
      number: item.number, type: item.type, stem: item.stem, options: safeJson<string[]>(item.optionsJson ?? "[]", []), answer: item.answer, analysis: item.analysis, tags: item.tags,
    })));
    const roster = transaction.prepare(
      `SELECT cs.class_id AS classId, cs.student_id AS studentId FROM class_students cs
       WHERE cs.class_id IN (${placeholders})`,
    ).all(...classIds) as Array<{ classId: string; studentId: string }>;
    const addSubmission = transaction.prepare(
      "INSERT INTO submissions (id, assignment_id, class_id, student_id, status, updated_at) VALUES (?, ?, ?, ?, 'assigned', ?)",
    );
    roster.forEach((student) => addSubmission.run(crypto.randomUUID(), id, student.classId, student.studentId, timestamp));
  });
  return { id, assignmentCode, totalScore, studentCount: (sqlite.prepare("SELECT COUNT(*) AS count FROM submissions WHERE assignment_id = ?").get(id) as { count: number }).count };
}

export async function getAssignmentDetail(ownerId: string, assignmentId: string) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const assignment = sqlite.prepare(
    `SELECT a.id, a.paper_id AS paperId, a.title, a.assignment_code AS assignmentCode, a.status,
       a.due_at AS dueAt, a.total_score AS totalScore, a.created_at AS createdAt, a.updated_at AS updatedAt,
       p.title AS paperTitle FROM assignments a JOIN papers p ON p.id = a.paper_id WHERE a.id = ? AND a.owner_id = ?`,
  ).get(assignmentId, ownerId) as Record<string, unknown> | undefined;
  if (!assignment) throw new Error("作业不存在");
  const classes = sqlite.prepare(
    `SELECT c.id, c.name, c.grade FROM assignment_classes ac JOIN teaching_classes c ON c.id = ac.class_id
     WHERE ac.assignment_id = ? ORDER BY c.name`,
  ).all(assignmentId) as Array<{ id: string; name: string; grade: string }>;
  const itemRows = sqlite.prepare(
    "SELECT question_id AS questionId, position, max_score AS maxScore, snapshot_json AS snapshotJson FROM assignment_items WHERE assignment_id = ? ORDER BY position",
  ).all(assignmentId) as Array<{ questionId: string; position: number; maxScore: number; snapshotJson: string }>;
  const items = itemRows.map(({ snapshotJson, ...item }) => ({ ...item, snapshot: safeJson<Record<string, unknown>>(snapshotJson, {}) }));
  const submissions = sqlite.prepare(
    `SELECT s.id, s.class_id AS classId, c.name AS className, s.student_id AS studentId,
       st.student_no AS studentNo, st.name AS studentName, s.status, s.total_score AS totalScore,
       s.teacher_comment AS teacherComment, s.graded_at AS gradedAt, s.updated_at AS updatedAt
     FROM submissions s JOIN teaching_classes c ON c.id = s.class_id JOIN students st ON st.id = s.student_id
     WHERE s.assignment_id = ? ORDER BY c.name, CASE WHEN (SELECT seat_number FROM class_students WHERE class_id = s.class_id AND student_id = s.student_id) IS NULL THEN 1 ELSE 0 END,
       (SELECT seat_number FROM class_students WHERE class_id = s.class_id AND student_id = s.student_id), st.student_no`,
  ).all(assignmentId) as Array<{ id: string; classId: string; className: string; studentId: string; studentNo: string; studentName: string; status: string; totalScore: number | null; teacherComment: string; gradedAt: string | null; updatedAt: string }>;
  const scoreRows = sqlite.prepare(
    `SELECT ss.submission_id AS submissionId, ss.question_id AS questionId, ss.score, ss.comment
     FROM submission_scores ss JOIN submissions s ON s.id = ss.submission_id WHERE s.assignment_id = ?`,
  ).all(assignmentId) as Array<{ submissionId: string; questionId: string; score: number; comment: string }>;
  const scoresBySubmission = new Map<string, Record<string, number>>();
  scoreRows.forEach((score) => { const values = scoresBySubmission.get(score.submissionId) ?? {}; values[score.questionId] = score.score; scoresBySubmission.set(score.submissionId, values); });
  const hydratedSubmissions = submissions.map((submission) => ({ ...submission, scores: scoresBySubmission.get(submission.id) ?? {} }));
  const analytics = calculateAssignmentAnalytics(
    items.map((item) => ({ questionId: item.questionId, position: item.position, maxScore: item.maxScore, tags: Array.isArray(item.snapshot.tags) ? item.snapshot.tags.map(String) : [] })),
    hydratedSubmissions.map((submission) => ({ studentId: submission.studentId, studentName: submission.studentName, status: submission.status, scores: submission.scores })),
  );
  return { assignment, classes, items, submissions: hydratedSubmissions, analytics };
}

export async function saveSubmissionScores(ownerId: string, assignmentId: string, submissionId: string, input: { scores?: unknown; teacherComment?: unknown }) {
  await ensureDatabase();
  if (!input.scores || typeof input.scores !== "object" || Array.isArray(input.scores)) throw new Error("逐题得分格式无效");
  const scoreInput = input.scores as Record<string, unknown>;
  const teacherComment = typeof input.teacherComment === "string" ? input.teacherComment.trim() : "";
  if (teacherComment.length > 1000) throw new Error("评语不能超过 1000 字");
  const sqlite = getSqlite();
  if (!sqlite.prepare(
    `SELECT 1 FROM submissions s JOIN assignments a ON a.id = s.assignment_id
     WHERE s.id = ? AND s.assignment_id = ? AND a.owner_id = ?`,
  ).get(submissionId, assignmentId, ownerId)) throw new Error("学生作答不存在");
  const items = sqlite.prepare("SELECT question_id AS questionId, max_score AS maxScore FROM assignment_items WHERE assignment_id = ?").all(assignmentId) as Array<{ questionId: string; maxScore: number }>;
  const normalized = items.map((item) => {
    const value = Number(scoreInput[item.questionId]);
    if (!Number.isFinite(value) || value < 0 || value > item.maxScore) throw new Error(`第 ${items.indexOf(item) + 1} 题得分应在 0–${item.maxScore} 之间`);
    return { ...item, score: Math.round(value * 100) / 100 };
  });
  const totalScore = normalized.reduce((sum, item) => sum + item.score, 0);
  const timestamp = now();
  sqliteTransaction((transaction) => {
    const upsert = transaction.prepare(
      `INSERT INTO submission_scores (submission_id, question_id, score, comment, updated_at) VALUES (?, ?, ?, '', ?)
       ON CONFLICT(submission_id, question_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
    );
    normalized.forEach((item) => upsert.run(submissionId, item.questionId, item.score, timestamp));
    transaction.prepare(
      `UPDATE submissions SET status = 'graded', total_score = ?, teacher_comment = ?, graded_at = ?, updated_at = ?
       WHERE id = ? AND assignment_id = ?`,
    ).run(totalScore, teacherComment, timestamp, timestamp, submissionId, assignmentId);
    transaction.prepare("UPDATE assignments SET updated_at = ? WHERE id = ?").run(timestamp, assignmentId);
  });
  return { saved: true, totalScore, gradedAt: timestamp };
}

export async function setAssignmentStatus(ownerId: string, assignmentId: string, status: "active" | "closed") {
  await ensureDatabase();
  const result = getSqlite().prepare("UPDATE assignments SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(status, now(), assignmentId, ownerId);
  if (!result.changes) throw new Error("作业不存在");
  return { status };
}
