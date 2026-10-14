import type Database from "better-sqlite3";

export const EXTRACTION_SPEED_WINDOW_SECONDS = 10;

/** New AI questions only: edits, approvals, imports and retry overwrites do not inflate throughput. */
export function getExtractionSpeed(sqlite: Database.Database, ownerId: string, sampledAt = new Date()) {
  const timestamp = sampledAt.toISOString();
  const since = new Date(sampledAt.getTime() - EXTRACTION_SPEED_WINDOW_SECONDS * 1000).toISOString();
  // Checkpoints and question writes commit together. Restrict to recently
  // updated jobs first so monitoring never scans every historical question.
  const { count, startedAt, firstQuestionAt } = sqlite.prepare(`WITH recent_jobs AS MATERIALIZED (
      SELECT j.document_id, j.completed_question_numbers_json, j.started_at FROM document_jobs j
      JOIN documents d ON d.id = j.document_id AND d.owner_id = j.owner_id
      WHERE j.owner_id = ? AND (j.updated_at > ? OR j.status = 'processing') AND d.source_kind = 'uploaded'
    )
    SELECT COUNT(*) AS count, MIN(q.created_at) AS firstQuestionAt,
      (SELECT MIN(started_at) FROM recent_jobs) AS startedAt FROM recent_jobs j
    JOIN questions q ON q.document_id = j.document_id
    WHERE q.created_at > ? AND q.created_at <= ? AND LENGTH(TRIM(q.stem)) > 0
      AND EXISTS (SELECT 1 FROM json_each(j.completed_question_numbers_json) n WHERE n.value = q.number)`)
    .get(ownerId, since, since, timestamp) as { count: number; startedAt: string | null; firstQuestionAt: string | null };
  // A newly started batch has only observed a few seconds, not a full window.
  // Include older completed output when a retry changes the job's start time.
  const observedStart = Math.min(...[startedAt, firstQuestionAt].flatMap(value => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? [parsed] : [];
  }));
  const windowSeconds = Number.isFinite(observedStart)
    ? Math.min(EXTRACTION_SPEED_WINDOW_SECONDS, Math.max(1, (sampledAt.getTime() - observedStart) / 1000))
    : EXTRACTION_SPEED_WINDOW_SECONDS;
  return {
    questionsPerSecond: count / windowSeconds,
    completedQuestions: count,
    windowSeconds,
    sampledAt: timestamp,
  };
}

export type ExtractionSpeed = ReturnType<typeof getExtractionSpeed>;
