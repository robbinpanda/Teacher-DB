import type Database from "better-sqlite3";

export type ActivateExtractionRunInput = {
  proposedRunId: string;
  documentId: string;
  pageId: string;
  pageNumber: number;
  profileId: string;
  provider: string;
  model: string;
  idempotencyKey: string;
  timestamp: string;
};

export function activateExtractionRun(sqlite: Database.Database, input: ActivateExtractionRunInput) {
  return sqlite.prepare(
    `INSERT INTO extraction_runs
      (id, document_id, page_id, page_number, model_profile_id, provider, model, status, attempt, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 1, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       page_id = excluded.page_id, page_number = excluded.page_number,
       model_profile_id = excluded.model_profile_id, provider = excluded.provider,
       model = excluded.model, status = 'running', attempt = extraction_runs.attempt + 1,
       raw_json = NULL, error = NULL, error_code = NULL, next_attempt_at = NULL,
       lease_owner = NULL, lease_expires_at = NULL, created_at = excluded.created_at, finished_at = NULL
     RETURNING id, attempt`,
  ).get(
    input.proposedRunId, input.documentId, input.pageId, input.pageNumber, input.profileId,
    input.provider, input.model, input.idempotencyKey, input.timestamp,
  ) as { id: string; attempt: number };
}
