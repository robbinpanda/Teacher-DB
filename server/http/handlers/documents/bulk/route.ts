import { sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import {
  approveAllDocumentsWithoutReview,
  approveDocumentsWithoutReview,
  deleteDocuments,
  DocumentBulkActionError,
  normalizeDocumentIds,
  type BulkDeleteMode,
} from "../../../../../lib/document-bulk-actions";
import { deleteFile } from "../../../../../lib/file-storage";
import { getDocumentIntegrity, integrityError } from "../../../../../lib/document-integrity";
import { now, requestOwner } from "../../../../../lib/server";


export async function POST(request: Request) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const payload = await request.json().catch(() => ({})) as {
    action?: "approve_without_review" | "approve_all_without_review" | "delete";
    documentIds?: unknown;
    mode?: BulkDeleteMode;
  };
  try {
    const timestamp = now();
    if (payload.action === "approve_without_review" || payload.action === "approve_all_without_review") {
      const outcome = sqliteTransaction((transaction) => {
        const input = {
          ownerId,
          timestamp,
          reviewReadinessError: (documentId: string) => {
            const integrity = getDocumentIntegrity(transaction, documentId)!;
            return integrity.reviewReady ? null : integrityError(integrity);
          },
        };
        return payload.action === "approve_all_without_review"
          ? approveAllDocumentsWithoutReview(transaction, input)
          : { ...approveDocumentsWithoutReview(transaction, { ...input, documentIds: normalizeDocumentIds(payload.documentIds) }), skippedDocuments: [] };
      });
      const completedDocuments = outcome.documents.filter((document) => document.status === "complete").length;
      const reviewRequired = outcome.documents.reduce((sum, document) => sum + document.reviewRequired, 0);
      return Response.json({
        action: payload.action,
        changed: outcome.changed,
        selectedDocuments: outcome.documents.length + outcome.skippedDocuments.length,
        completedDocuments,
        reviewRequired,
        documents: outcome.documents,
        skippedDocuments: outcome.skippedDocuments,
      });
    }
    if (payload.action === "delete") {
      const documentIds = normalizeDocumentIds(payload.documentIds);
      if (!new Set<BulkDeleteMode>(["with_questions", "source_only"]).has(payload.mode as BulkDeleteMode)) {
        throw new DocumentBulkActionError("请选择删除方式", 400);
      }
      const outcome = sqliteTransaction((transaction) => deleteDocuments(transaction, {
        ownerId,
        documentIds,
        mode: payload.mode as BulkDeleteMode,
        timestamp,
      }));
      const removedFiles = await Promise.allSettled(outcome.fileKeys.map((key) => deleteFile(key)));
      return Response.json({
        action: payload.action,
        mode: payload.mode,
        deleted: outcome.deleted,
        questionsRetained: payload.mode === "source_only",
        fileDeleteFailures: removedFiles.filter((result) => result.status === "rejected").length,
      });
    }
    throw new DocumentBulkActionError("批量操作无效", 400);
  } catch (error) {
    if (error instanceof DocumentBulkActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
