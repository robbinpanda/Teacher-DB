import { sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { deleteFile } from "../../../../../lib/file-storage";
import { now, requestOwner } from "../../../../../lib/server";
import { getDocumentIntegrity, integrityError } from "../../../../../lib/document-integrity";
import { readJsonPayload } from "../../../../../lib/request-payload";
import { deleteDocuments, DocumentBulkActionError, type BulkDeleteMode } from "../../../../../lib/document-bulk-actions";
import { canTransitionDocument, documentStatuses } from "../../../../../lib/document-state";


export async function PATCH(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const parsed = await readJsonPayload<{
    status?: string;
    subject?: string;
    grade?: string;
    year?: number | null;
    examType?: string | null;
    region?: string | null;
    textbook?: string | null;
    school?: string | null;
    error?: string | null;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const textFields = [payload.subject, payload.grade, payload.examType, payload.region, payload.textbook, payload.school, payload.error];
  if ((payload.status !== undefined && typeof payload.status !== "string")
    || textFields.some((value) => value !== undefined && value !== null && typeof value !== "string")
    || (payload.year !== undefined && payload.year !== null
      && (!Number.isInteger(payload.year) || payload.year < 1900 || payload.year > 2200))) {
    return Response.json({ error: "文档信息格式无效" }, { status: 400 });
  }
  if ((payload.subject?.length ?? 0) > 60 || (payload.grade?.length ?? 0) > 60
    || (payload.examType?.length ?? 0) > 120 || (payload.region?.length ?? 0) > 200
    || (payload.textbook?.length ?? 0) > 200 || (payload.school?.length ?? 0) > 200
    || (payload.error?.length ?? 0) > 4_000) {
    return Response.json({ error: "文档信息字段过长" }, { status: 400 });
  }
  const allowedStatuses = new Set<string>(documentStatuses);
  if (payload.status && !allowedStatuses.has(payload.status)) {
    return Response.json({ error: "非法文档状态" }, { status: 400 });
  }
  const outcome = sqliteTransaction((transaction) => {
    const document = transaction.prepare(
      "SELECT status FROM documents WHERE id = ? AND owner_id = ?",
    ).get(documentId, ownerId) as { status: string } | undefined;
    if (!document) return { error: "文档不存在", statusCode: 404 } as const;
    if (payload.status && !canTransitionDocument(document.status, payload.status)) {
      return { error: `不能从 ${document.status} 直接转换为 ${payload.status}`, statusCode: 409 } as const;
    }
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
    if (payload.textbook !== undefined) add("source_textbook", payload.textbook || null);
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
  const payload = await request.json().catch(() => ({})) as { mode?: BulkDeleteMode };
  if (!new Set<BulkDeleteMode>(["with_questions", "source_only"]).has(payload.mode as BulkDeleteMode)) {
    return Response.json({ error: "请选择删除方式" }, { status: 400 });
  }
  try {
    const outcome = sqliteTransaction((transaction) => deleteDocuments(transaction, {
      ownerId,
      documentIds: [documentId],
      mode: payload.mode as BulkDeleteMode,
      timestamp: now(),
    }));
    const removedFiles = await Promise.allSettled(outcome.fileKeys.map((key) => deleteFile(key)));
    return Response.json({
      deleted: true,
      mode: payload.mode,
      questionsRetained: payload.mode === "source_only",
      fileDeleteFailures: removedFiles.filter((result) => result.status === "rejected").length,
    });
  } catch (error) {
    if (error instanceof DocumentBulkActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
