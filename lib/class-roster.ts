import type Database from "better-sqlite3";
import type { RosterRow } from "./roster-csv";

// Caller holds the write transaction: a conflicting row rolls back the entire import.
export function applyClassRoster(sqlite: Database.Database, ownerId: string, classId: string, rows: RosterRow[], timestamp: string) {
  const teachingClass = sqlite.prepare("SELECT archived FROM teaching_classes WHERE id = ? AND owner_id = ?").get(classId, ownerId) as { archived: number } | undefined;
  if (!teachingClass) throw new Error("班级不存在");
  if (teachingClass.archived) throw new Error("班级已归档，请先恢复班级");
  const find = sqlite.prepare("SELECT id, name FROM students WHERE owner_id = ? AND student_no = ?");
  const insert = sqlite.prepare("INSERT INTO students (id, owner_id, student_no, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  const link = sqlite.prepare(`INSERT INTO class_students (class_id, student_id, seat_number, joined_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(class_id, student_id) DO UPDATE SET seat_number = excluded.seat_number`);
  for (const row of rows) {
    const existing = find.get(ownerId, row.studentNo) as { id: string; name: string } | undefined;
    if (existing && existing.name !== row.name) throw new Error(`学号“${row.studentNo}”已属于“${existing.name}”，与“${row.name}”冲突；本次未导入任何学生，请核对学号`);
    const studentId = existing?.id ?? crypto.randomUUID();
    if (!existing) insert.run(studentId, ownerId, row.studentNo, row.name, timestamp, timestamp);
    link.run(classId, studentId, row.seatNumber, timestamp);
  }
  sqlite.prepare("UPDATE teaching_classes SET updated_at = ? WHERE id = ?").run(timestamp, classId);
}
