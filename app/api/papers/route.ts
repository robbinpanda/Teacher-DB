import { getSqlite, sqliteTransaction } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { now, requestOwner } from "../../../lib/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await ensureDatabase();
  const payload = await request.json() as {
    id?: string;
    title?: string;
    subtitle?: string;
    questionIds?: string[];
    settings?: Record<string, unknown>;
  };
  const id = payload.id?.trim() || crypto.randomUUID();
  const title = payload.title?.trim();
  const questionIds = Array.from(new Set(payload.questionIds ?? [])).slice(0, 500);
  if (!title) return Response.json({ error: "试卷标题不能为空" }, { status: 400 });
  const ownerId = requestOwner(request);
  const sqlite = getSqlite();
  const existing = sqlite.prepare("SELECT owner_id AS ownerId FROM papers WHERE id = ?").get(id) as { ownerId: string } | undefined;
  if (existing && existing.ownerId !== ownerId) return Response.json({ error: "试卷不存在" }, { status: 404 });

  if (questionIds.length) {
    const placeholders = questionIds.map(() => "?").join(",");
    const row = sqlite.prepare(
      `SELECT COUNT(*) AS count FROM questions q JOIN documents d ON d.id = q.document_id
        WHERE d.owner_id = ? AND q.status = 'approved' AND q.id IN (${placeholders})`,
    ).get(ownerId, ...questionIds) as { count: number };
    if (row.count !== questionIds.length) return Response.json({ error: "试卷中包含不存在或未审核的题目" }, { status: 400 });
  }

  const timestamp = now();
  sqliteTransaction((transaction) => {
    transaction.prepare(
      `INSERT INTO papers (id, owner_id, title, subtitle, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
         settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
    ).run(id, ownerId, title, payload.subtitle ?? "", JSON.stringify(payload.settings ?? {}), timestamp, timestamp);
    transaction.prepare("DELETE FROM paper_items WHERE paper_id = ?").run(id);
    const insert = transaction.prepare("INSERT INTO paper_items (paper_id, question_id, position, score) VALUES (?, ?, ?, ?)");
    questionIds.forEach((questionId, position) => {
      insert.run(id, questionId, position, 0);
    });
  });
  return Response.json({ id, saved: true, updatedAt: timestamp }, { status: existing ? 200 : 201 });
}
