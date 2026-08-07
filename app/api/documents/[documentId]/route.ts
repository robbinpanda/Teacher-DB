import { getSqlite, sqliteTransaction } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { deleteFile } from "../../../../lib/file-storage";
import { now, requestOwner } from "../../../../lib/server";
import { getDocumentIntegrity, integrityError } from "../../../../lib/document-integrity";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const payload = await request.json() as {
    status?: string;
    subject?: string;
    grade?: string;
    year?: number | null;
    examType?: string | null;
    region?: string | null;
    school?: string | null;
    error?: string | null;
  };
  const allowedStatuses = new Set(["uploading", "extracting", "reviewing", "failed", "complete"]);
  if (payload.status && !allowedStatuses.has(payload.status)) {
    return Response.json({ error: "非法文档状态" }, { status: 400 });
  }
  const outcome = sqliteTransaction((transaction) => {
    const document = transaction.prepare(
      "SELECT status FROM documents WHERE id = ? AND owner_id = ?",
    ).get(documentId, ownerId) as { status: string } | undefined;
    if (!document) return { error: "文档不存在", statusCode: 404 } as const;
    if (payload.status === "complete") {
      const counts = transaction.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved
           FROM questions WHERE document_id = ?`,
      ).get(documentId) as { total: number; approved: number };
      if (!counts.total) return { error: "还没有可入库的题目", statusCode: 409 } as const;
      if (counts.approved !== counts.total) {
        return { error: `还有 ${counts.total - counts.approved} 道题未审核，不能完成入库`, statusCode: 409 } as const;
      }
      const integrity = getDocumentIntegrity(transaction, documentId)!;
      if (!integrity.reviewReady) return { error: integrityError(integrity), statusCode: 409 } as const;
    }

    const assignments = ["updated_at = ?"];
    const values: unknown[] = [now()];
    const add = (column: string, value: unknown) => { assignments.push(`${column} = ?`); values.push(value); };
    if (payload.status) add("status", payload.status);
    if (payload.subject !== undefined) add("subject", payload.subject || null);
    if (payload.grade !== undefined) add("grade", payload.grade || null);
    if (payload.year !== undefined) add("source_year", payload.year);
    if (payload.examType !== undefined) add("source_exam_type", payload.examType || null);
    if (payload.region !== undefined) add("source_region", payload.region || null);
    if (payload.school !== undefined) add("source_school", payload.school || null);
    if (payload.error !== undefined) add("error", payload.error?.slice(0, 4000) || null);
    transaction.prepare(
      `UPDATE documents SET ${assignments.join(", ")} WHERE id = ? AND owner_id = ?`,
    ).run(...values, documentId, ownerId);
    return { saved: true, status: payload.status ?? document.status } as const;
  });
  if ("error" in outcome) return Response.json({ error: outcome.error }, { status: outcome.statusCode });
  return Response.json(outcome);
}

export async function DELETE(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const payload = await request.json().catch(() => ({})) as { mode?: "with_questions" | "source_only" };
  if (!new Set(["with_questions", "source_only"]).has(payload.mode ?? "")) {
    return Response.json({ error: "请选择删除方式" }, { status: 400 });
  }
  const sqlite = getSqlite();
  const document = sqlite.prepare(
    `SELECT id, original_key AS originalKey, source_removed_at AS sourceRemovedAt
       FROM documents WHERE id = ? AND owner_id = ?`,
  ).get(documentId, ownerId) as { id: string; originalKey: string | null; sourceRemovedAt: string | null } | undefined;
  if (!document || document.sourceRemovedAt) return Response.json({ error: "试卷不存在或已删除" }, { status: 404 });
  const pageKeys = sqlite.prepare("SELECT storage_key AS storageKey FROM pages WHERE document_id = ?")
    .all(documentId) as Array<{ storageKey: string }>;
  const cropKeys = payload.mode === "with_questions"
    ? sqlite.prepare(
        `SELECT a.crop_key AS cropKey FROM question_assets a
          JOIN questions q ON q.id = a.question_id
         WHERE q.document_id = ? AND a.crop_key IS NOT NULL`,
      ).all(documentId) as Array<{ cropKey: string }>
    : [];
  const fileKeys = Array.from(new Set([
    document.originalKey,
    ...pageKeys.map((page) => page.storageKey),
    ...cropKeys.map((asset) => asset.cropKey),
  ].filter((key): key is string => Boolean(key))));
  const timestamp = now();
  if (payload.mode === "with_questions") {
    sqliteTransaction((transaction) => {
      transaction.prepare(
        `DELETE FROM paper_items WHERE question_id IN (SELECT id FROM questions WHERE document_id = ?)`,
      ).run(documentId);
      transaction.prepare("DELETE FROM documents WHERE id = ? AND owner_id = ?").run(documentId, ownerId);
      transaction.prepare("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM question_tags)").run();
    });
  } else {
    sqliteTransaction((transaction) => {
      transaction.prepare("DELETE FROM document_jobs WHERE document_id = ?").run(documentId);
      transaction.prepare("DELETE FROM extraction_runs WHERE document_id = ?").run(documentId);
      transaction.prepare("DELETE FROM pages WHERE document_id = ?").run(documentId);
      transaction.prepare(
        `UPDATE documents SET original_key = NULL, source_removed_at = ?, updated_at = ?
          WHERE id = ? AND owner_id = ?`,
      ).run(timestamp, timestamp, documentId, ownerId);
    });
  }
  const removedFiles = await Promise.allSettled(fileKeys.map((key) => deleteFile(key)));
  const fileDeleteFailures = removedFiles.filter((result) => result.status === "rejected").length;
  return Response.json({
    deleted: true,
    mode: payload.mode,
    questionsRetained: payload.mode === "source_only",
    fileDeleteFailures,
  });
}
