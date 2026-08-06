import { getSqlite, sqliteTransaction } from "../../../../../../db";
import { ensureDatabase } from "../../../../../../db/bootstrap";
import { now, requestOwner } from "../../../../../../lib/server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const payload = await request.json().catch(() => ({})) as {
    action?: "approve_without_review" | "remove_all_from_bank";
  };
  if (!new Set(["approve_without_review", "remove_all_from_bank"]).has(payload.action ?? "")) {
    return Response.json({ error: "批量操作无效" }, { status: 400 });
  }
  const sqlite = getSqlite();
  const document = sqlite.prepare(
    `SELECT id, source_removed_at AS sourceRemovedAt FROM documents WHERE id = ? AND owner_id = ?`,
  ).get(documentId, ownerId) as { id: string; sourceRemovedAt: string | null } | undefined;
  if (!document) return Response.json({ error: "试卷不存在" }, { status: 404 });
  if (document.sourceRemovedAt) return Response.json({ error: "原试卷已删除，题目无法再修改" }, { status: 409 });

  const timestamp = now();
  const changed = sqliteTransaction((transaction) => {
    const result = payload.action === "approve_without_review"
      ? transaction.prepare(
          `UPDATE questions SET status = 'approved', updated_at = ?
            WHERE document_id = ? AND needs_human_review = 0 AND status = 'pending'`,
        ).run(timestamp, documentId)
      : transaction.prepare(
          `UPDATE questions SET status = 'pending', updated_at = ?
            WHERE document_id = ? AND status = 'approved'`,
        ).run(timestamp, documentId);
    transaction.prepare(
      `UPDATE documents SET status = CASE
         WHEN ? = 'approve_without_review'
           AND page_count > 0
           AND (SELECT COUNT(*) FROM extraction_runs WHERE document_id = documents.id AND status = 'complete') >= page_count
           AND EXISTS (SELECT 1 FROM questions WHERE document_id = documents.id)
           AND NOT EXISTS (SELECT 1 FROM questions WHERE document_id = documents.id AND status <> 'approved')
         THEN 'complete' ELSE 'reviewing' END,
       updated_at = ? WHERE id = ?`,
    ).run(payload.action, timestamp, documentId);
    return result.changes;
  });
  const counts = sqlite.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status <> 'approved' AND (needs_human_review IS NULL OR needs_human_review <> 0) THEN 1 ELSE 0 END) AS reviewRequired
       FROM questions WHERE document_id = ?`,
  ).get(documentId) as { total: number; approved: number | null; reviewRequired: number | null };
  return Response.json({
    action: payload.action,
    changed,
    total: counts.total,
    approved: counts.approved ?? 0,
    reviewRequired: counts.reviewRequired ?? 0,
  });
}
