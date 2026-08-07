import { sqliteTransaction } from "../../../../../../db";
import { ensureDatabase } from "../../../../../../db/bootstrap";
import { now, requestOwner } from "../../../../../../lib/server";
import { getDocumentIntegrity, integrityError } from "../../../../../../lib/document-integrity";

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
  const timestamp = now();
  const outcome = sqliteTransaction((transaction) => {
    const document = transaction.prepare(
      `SELECT id, source_removed_at AS sourceRemovedAt FROM documents WHERE id = ? AND owner_id = ?`,
    ).get(documentId, ownerId) as { id: string; sourceRemovedAt: string | null } | undefined;
    if (!document) return { error: "试卷不存在", statusCode: 404 } as const;
    if (document.sourceRemovedAt) return { error: "原试卷已删除，题目无法再修改", statusCode: 409 } as const;
    if (payload.action === "approve_without_review") {
      const integrity = getDocumentIntegrity(transaction, documentId)!;
      if (!integrity.reviewReady) return { error: integrityError(integrity), statusCode: 409 } as const;
    }
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
    const counts = transaction.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN status <> 'approved' AND (needs_human_review IS NULL OR needs_human_review <> 0) THEN 1 ELSE 0 END) AS reviewRequired
         FROM questions WHERE document_id = ?`,
    ).get(documentId) as { total: number; approved: number | null; reviewRequired: number | null };
    return { changed: result.changes, counts } as const;
  });
  if ("error" in outcome) return Response.json({ error: outcome.error }, { status: outcome.statusCode });
  return Response.json({
    action: payload.action,
    changed: outcome.changed,
    total: outcome.counts.total,
    approved: outcome.counts.approved ?? 0,
    reviewRequired: outcome.counts.reviewRequired ?? 0,
  });
}
