import type Database from "better-sqlite3";

export class PageContentLockedError extends Error {}

export type SavePageRecordInput = {
  documentId: string;
  ownerId: string;
  pageNumber: number;
  storageKey: string;
  width: number;
  height: number;
  checksum: string;
  timestamp: string;
};

export function savePageRecord(transaction: Database.Database, input: SavePageRecordInput) {
  const ownedDocument = transaction.prepare(
    "SELECT page_count AS pageCount, source_removed_at AS sourceRemovedAt FROM documents WHERE id = ? AND owner_id = ?",
  ).get(input.documentId, input.ownerId) as { pageCount: number; sourceRemovedAt: string | null } | undefined;
  if (!ownedDocument || ownedDocument.sourceRemovedAt) throw new Error("文档在页面保存前已被删除");
  if (input.pageNumber > ownedDocument.pageCount) throw new Error("原卷声明页数已变化，请重新开始上传");

  const existing = transaction.prepare(
    `SELECT id, storage_key AS storageKey, checksum FROM pages
      WHERE document_id = ? AND page_number = ?`,
  ).get(input.documentId, input.pageNumber) as { id: string; storageKey: string; checksum: string | null } | undefined;
  const contentChanged = Boolean(existing && existing.checksum !== input.checksum);
  if (contentChanged) {
    const derived = transaction.prepare(
      `SELECT 1
         WHERE EXISTS (SELECT 1 FROM extraction_runs WHERE document_id = ? AND page_number = ? AND status = 'complete')
            OR EXISTS (SELECT 1 FROM question_regions WHERE page_id = ?)
            OR EXISTS (SELECT 1 FROM question_assets WHERE page_id = ?)
         LIMIT 1`,
    ).get(input.documentId, input.pageNumber, existing!.id, existing!.id);
    if (derived) {
      throw new PageContentLockedError(`第 ${input.pageNumber} 页已有识别结果，不能用不同图片覆盖；请新建试卷重新上传`);
    }
  }

  const pageId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    transaction.prepare(
      `UPDATE pages SET storage_key = ?, width = ?, height = ?, status = 'ready', checksum = ?
        WHERE id = ?`,
    ).run(input.storageKey, input.width, input.height, input.checksum, pageId);
  } else {
    transaction.prepare(
      `INSERT INTO pages (id, document_id, page_number, storage_key, width, height, status, checksum, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    ).run(
      pageId, input.documentId, input.pageNumber, input.storageKey,
      input.width, input.height, input.checksum, input.timestamp,
    );
  }

  const idempotencyKey = `${input.documentId}:page:${input.pageNumber}:extract-v3`;
  transaction.prepare(
    `INSERT INTO extraction_runs
      (id, document_id, page_id, page_number, provider, model, status, attempt, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, 'pending', 'pending', 'queued', 0, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET page_id = excluded.page_id, page_number = excluded.page_number`,
  ).run(crypto.randomUUID(), input.documentId, pageId, input.pageNumber, idempotencyKey, input.timestamp);
  if (contentChanged) {
    transaction.prepare(
      `UPDATE extraction_runs SET status = 'queued', attempt = 0, raw_json = NULL, error = NULL,
         error_code = NULL, next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = NULL
       WHERE idempotency_key = ?`,
    ).run(idempotencyKey);
  }
  return { pageId, created: !existing, previousStorageKey: existing?.storageKey ?? null };
}
