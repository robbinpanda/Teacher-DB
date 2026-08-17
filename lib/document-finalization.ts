import type Database from "better-sqlite3";

export function unresolvedAnswerUpdateNumbers(
  pipelineUnmatchedNumbers: unknown[],
  answerUpdateNumbers: unknown[],
  existingQuestionNumbers: Iterable<string>,
) {
  const existing = new Set(existingQuestionNumbers);
  return Array.from(new Set(
    [...pipelineUnmatchedNumbers, ...answerUpdateNumbers]
      .map((number) => String(number ?? "").trim())
      .filter((number) => /^[1-9]\d*$/.test(number) && !existing.has(number)),
  )).sort((left, right) => Number(left) - Number(right));
}

export function finalizeDocumentState(
  sqlite: Database.Database,
  input: { documentId: string; terminalError: string | null; timestamp: string },
) {
  const status = input.terminalError ? "failed" : "reviewing";
  sqlite.prepare("UPDATE documents SET status = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(status, input.terminalError, input.timestamp, input.documentId);
  sqlite.prepare(
    `UPDATE document_jobs SET status = ?, next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
       last_error = ?, stream_phase = ?, stream_message = ?, finished_at = ?, updated_at = ? WHERE document_id = ?`,
  ).run(
    input.terminalError ? "failed" : "complete",
    input.terminalError,
    input.terminalError ? "error" : "complete",
    input.terminalError ?? "整卷识别完成，进入人工审核",
    input.timestamp,
    input.timestamp,
    input.documentId,
  );
}
