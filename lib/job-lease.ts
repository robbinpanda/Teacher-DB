import type Database from "better-sqlite3";

export class LostDocumentLeaseError extends Error {
  readonly code = "lease_lost";

  constructor(documentId: string) {
    super(`文档 ${documentId} 的识别租约已失效，已丢弃过期 worker 的写入`);
    this.name = "LostDocumentLeaseError";
  }
}

export function documentLeaseIsCurrent(
  sqlite: Database.Database,
  documentId: string,
  workerId: string,
  timestamp: string,
) {
  return Boolean(sqlite.prepare(
    `SELECT 1 FROM document_jobs
      WHERE document_id = ? AND status = 'processing' AND lease_owner = ?
        AND lease_expires_at IS NOT NULL AND lease_expires_at >= ?`,
  ).get(documentId, workerId, timestamp));
}

export function assertDocumentLease(
  sqlite: Database.Database,
  documentId: string,
  workerId: string,
  timestamp: string,
) {
  if (!documentLeaseIsCurrent(sqlite, documentId, workerId, timestamp)) {
    throw new LostDocumentLeaseError(documentId);
  }
}

export function renewDocumentLease(
  sqlite: Database.Database,
  documentId: string,
  workerId: string,
  timestamp: string,
  leaseExpiresAt: string,
) {
  const result = sqlite.prepare(
    `UPDATE document_jobs SET lease_expires_at = ?, updated_at = ?
      WHERE document_id = ? AND lease_owner = ? AND status = 'processing'
        AND lease_expires_at IS NOT NULL AND lease_expires_at >= ?`,
  ).run(leaseExpiresAt, timestamp, documentId, workerId, timestamp);
  return result.changes === 1;
}
