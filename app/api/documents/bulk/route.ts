import { sqliteTransaction } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import {
  approveDocumentsWithoutReview,
  deleteDocuments,
  DocumentBulkActionError,
  normalizeDocumentIds,
  type BulkDeleteMode,
} from "../../../../lib/document-bulk-actions";
import { deleteFile } from "../../../../lib/file-storage";
import { getDocumentIntegrity, integrityError } from "../../../../lib/document-integrity";
import { now, requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const payload = await request.json().catch(() => ({})) as {
    action?: "approve_without_review" | "delete";
    documentIds?: unknown;
    mode?: BulkDeleteMode;
  };
  try {
    const documentIds = normalizeDocumentIds(payload.documentIds);
    const timestamp = now();
    if (payload.action === "approve_without_review") {
      const outcome = sqliteTransaction((transaction) => approveDocumentsWithoutReview(transaction, {
        ownerId,
        documentIds,
        timestamp,
        reviewReadinessError: (documentId) => {
          const integrity = getDocumentIntegrity(transaction, documentId)!;
          return integrity.reviewReady ? null : integrityError(integrity);
        },
      }));
      const completedDocuments = outcome.documents.filter((document) => document.status === "complete").length;
      const reviewRequired = outcome.documents.reduce((sum, document) => sum + document.reviewRequired, 0);
      return Response.json({
        action: payload.action,
        changed: outcome.changed,
        selectedDocuments: documentIds.length,
        completedDocuments,
        reviewRequired,
        documents: outcome.documents,
      });
    }
    if (payload.action === "delete") {
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
