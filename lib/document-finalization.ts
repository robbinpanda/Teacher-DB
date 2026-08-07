import type Database from "better-sqlite3";

export function finalizeDocumentState(
  sqlite: Database.Database,
  input: { documentId: string; terminalError: string | null; timestamp: string },
) {
  const status = input.terminalError ? "failed" : "reviewing";
  sqlite.prepare("UPDATE documents SET status = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(status, input.terminalError, input.timestamp, input.documentId);
  sqlite.prepare(
    `UPDATE document_jobs SET status = ?, next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
       last_error = ?, finished_at = ?, updated_at = ? WHERE document_id = ?`,
  ).run(
    input.terminalError ? "failed" : "complete",
    input.terminalError,
    input.timestamp,
    input.timestamp,
    input.documentId,
  );
}
