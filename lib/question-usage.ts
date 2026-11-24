import type Database from "better-sqlite3";
import type { QuestionUsage } from "./types";

export function questionUsage(db: Database.Database, ownerId: string, ids: string[]) {
  const result = new Map<string, QuestionUsage>();
  if (!ids.length) return result;
  // Assignment snapshots survive edits to the paper. Never expose another teacher's use of a shared question.
  const slots = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT pi.question_id AS questionId, p.id AS paperId, p.title AS paperTitle,
      p.created_at AS usedAt, NULL AS className, 0 AS priority FROM paper_items pi JOIN papers p ON p.id=pi.paper_id
      WHERE p.owner_id=? AND pi.question_id IN (${slots})
    UNION ALL
    SELECT ai.question_id AS questionId, a.paper_id AS paperId, a.title AS paperTitle,
      a.created_at AS usedAt, c.name AS className, 1 AS priority FROM assignment_items ai
      JOIN assignments a ON a.id=ai.assignment_id
      LEFT JOIN assignment_classes ac ON ac.assignment_id=a.id
      LEFT JOIN teaching_classes c ON c.id=ac.class_id AND c.owner_id=a.owner_id
      WHERE a.owner_id=? AND ai.question_id IN (${slots})
    ORDER BY 4 DESC, 6 DESC`).all(ownerId, ...ids, ownerId, ...ids) as Array<QuestionUsage & { questionId: string }>;
  for (const row of rows) if (!result.has(row.questionId)) result.set(row.questionId, { paperId: row.paperId, paperTitle: row.paperTitle, usedAt: row.usedAt, className: row.className });
  return result;
}

export function recentUseClause(days: number | undefined, ownerId: string, now = Date.now()) {
  if (!days || !Number.isFinite(days) || days < 1) return { sql: "", params: [] as string[] };
  const cutoff = new Date(now - Math.min(3650, days) * 86400000).toISOString();
  return { sql: `NOT EXISTS (SELECT 1 FROM paper_items upi JOIN papers up ON up.id=upi.paper_id WHERE upi.question_id=q.id AND up.owner_id=? AND up.created_at>=?)
    AND NOT EXISTS (SELECT 1 FROM assignment_items uai JOIN assignments ua ON ua.id=uai.assignment_id WHERE uai.question_id=q.id AND ua.owner_id=? AND ua.created_at>=?)`, params: [ownerId, cutoff, ownerId, cutoff] };
}
