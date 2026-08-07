import "server-only";

import { getSqlite, sqliteTransaction } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { resolveModelProfile } from "./model-profiles";
import { now } from "./server";
import {
  effectiveExtractionAttempt,
  MAX_EXTRACTION_ATTEMPTS,
  retryDelayMs,
  shouldPauseExtraction,
} from "./extraction-retry";
import { getDocumentIntegrity, integrityError } from "./document-integrity";
import { assertDocumentLease, LostDocumentLeaseError, renewDocumentLease } from "./job-lease";

const MAX_ACTIVE_DOCUMENTS = 2;
const LEASE_MS = 90_000;
const HEARTBEAT_MS = 25_000;

type JobRow = {
  documentId: string;
  ownerId: string;
  profileId: string | null;
  attempt: number;
};

type RunRow = {
  id: string;
  pageId: string;
  pageNumber: number;
  attempt: number;
};

type ExtractionFailure = {
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterMs?: number;
};

declare global {
  var __teacherDbQueuePump: Promise<void> | undefined;
  var __teacherDbQueueTimer: ReturnType<typeof setTimeout> | undefined;
}

function futureIso(delayMs: number) {
  return new Date(Date.now() + delayMs).toISOString();
}

function schedulePump(delayMs = 0) {
  if (global.__teacherDbQueueTimer) clearTimeout(global.__teacherDbQueueTimer);
  global.__teacherDbQueueTimer = setTimeout(() => {
    global.__teacherDbQueueTimer = undefined;
    void kickExtractionQueue();
  }, Math.max(0, delayMs));
  global.__teacherDbQueueTimer.unref?.();
}

export async function enqueueDocumentExtraction(input: {
  ownerId: string;
  documentId: string;
  profileId?: string;
  retry?: boolean;
}) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const document = sqlite.prepare(
    "SELECT id FROM documents WHERE id = ? AND owner_id = ?",
  ).get(input.documentId, input.ownerId) as { id: string } | undefined;
  if (!document) throw new Error("文档不存在");
  const integrity = getDocumentIntegrity(sqlite, input.documentId)!;
  if (integrity.missingPageNumbers.length || integrity.unexpectedPageNumbers.length || !integrity.storedPageNumbers.length) {
    throw new Error(integrityError(integrity));
  }
  const pages = sqlite.prepare(
    "SELECT id, page_number AS pageNumber FROM pages WHERE document_id = ? ORDER BY page_number",
  ).all(input.documentId) as Array<{ id: string; pageNumber: number }>;
  const profile = await resolveModelProfile(input.ownerId, input.profileId);
  const timestamp = now();
  sqliteTransaction((transaction) => {
    for (const page of pages) {
      transaction.prepare(
        `INSERT OR IGNORE INTO extraction_runs
          (id, document_id, page_id, page_number, model_profile_id, provider, model, status, attempt, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
      ).run(
        crypto.randomUUID(), input.documentId, page.id, page.pageNumber, profile.id,
        profile.provider, profile.model, `${input.documentId}:page:${page.pageNumber}:extract-v3`, timestamp,
      );
    }
    if (input.retry) {
      transaction.prepare(
        `UPDATE extraction_runs SET status = 'queued', error = NULL, error_code = NULL,
           next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = NULL,
           attempt = CASE WHEN status = 'failed' THEN 0 ELSE attempt END
         WHERE document_id = ? AND status <> 'complete'`,
      ).run(input.documentId);
      transaction.prepare("UPDATE document_jobs SET attempt = 0 WHERE document_id = ?")
        .run(input.documentId);
    }
    transaction.prepare(
      `INSERT INTO document_jobs
        (document_id, owner_id, profile_id, status, priority, attempt, queued_at, updated_at)
       VALUES (?, ?, ?, 'queued', 0, 0, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         owner_id = excluded.owner_id, profile_id = excluded.profile_id, status = 'queued',
         next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
         last_error = NULL, finished_at = NULL, updated_at = excluded.updated_at`,
    ).run(input.documentId, input.ownerId, profile.id, timestamp, timestamp);
    transaction.prepare("UPDATE documents SET status = 'extracting', error = NULL, updated_at = ? WHERE id = ?")
      .run(timestamp, input.documentId);
  });
  schedulePump();
  return getDocumentJob(input.ownerId, input.documentId);
}

export function getDocumentJob(ownerId: string, documentId: string) {
  return getSqlite().prepare(
    `SELECT document_id AS documentId, status, attempt, next_attempt_at AS nextAttemptAt,
       last_error AS lastError, queued_at AS queuedAt, started_at AS startedAt,
       finished_at AS finishedAt, updated_at AS updatedAt
     FROM document_jobs WHERE owner_id = ? AND document_id = ?`,
  ).get(ownerId, documentId);
}

export async function listDocumentJobs(ownerId: string) {
  await ensureDatabase();
  const jobs = getSqlite().prepare(
    `SELECT j.document_id AS documentId, d.name, j.status, j.attempt,
       j.next_attempt_at AS nextAttemptAt, j.last_error AS lastError,
       j.queued_at AS queuedAt, j.started_at AS startedAt, j.finished_at AS finishedAt,
       d.page_count AS totalPages,
       SUM(CASE WHEN r.status = 'complete' THEN 1 ELSE 0 END) AS completedPages,
       SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) AS failedPages,
       SUM(CASE WHEN r.status = 'retry_wait' THEN 1 ELSE 0 END) AS retryWaitPages
     FROM document_jobs j
     JOIN documents d ON d.id = j.document_id
     LEFT JOIN extraction_runs r ON r.document_id = j.document_id
     WHERE j.owner_id = ?
     GROUP BY j.document_id
     ORDER BY j.queued_at DESC LIMIT 100`,
  ).all(ownerId);
  schedulePump();
  return jobs;
}

function claimJobs() {
  const timestamp = now();
  return sqliteTransaction((transaction) => {
    transaction.prepare(
      `UPDATE document_jobs SET status = 'retry_wait', next_attempt_at = ?, lease_owner = NULL,
         lease_expires_at = NULL, last_error = COALESCE(last_error, '工作进程中断，已自动恢复'), updated_at = ?
       WHERE status = 'processing' AND lease_expires_at <= ?`,
    ).run(timestamp, timestamp, timestamp);
    transaction.prepare(
      `UPDATE extraction_runs SET status = 'retry_wait', next_attempt_at = ?,
         error = COALESCE(error, '工作进程租约过期，等待自动恢复')
       WHERE status = 'running' AND document_id IN (
         SELECT document_id FROM document_jobs WHERE status = 'retry_wait' AND next_attempt_at = ?
       )`,
    ).run(timestamp, timestamp);
    const active = (transaction.prepare(
      "SELECT COUNT(*) AS count FROM document_jobs WHERE status = 'processing' AND lease_expires_at >= ?",
    ).get(timestamp) as { count: number }).count;
    const capacity = Math.max(0, MAX_ACTIVE_DOCUMENTS - active);
    if (!capacity) return [] as JobRow[];
    const candidates = transaction.prepare(
      `SELECT document_id AS documentId, owner_id AS ownerId, profile_id AS profileId, attempt
       FROM document_jobs
       WHERE status IN ('queued', 'retry_wait') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY priority DESC, queued_at ASC LIMIT ?`,
    ).all(timestamp, capacity) as JobRow[];
    for (const job of candidates) {
      const workerId = crypto.randomUUID();
      transaction.prepare(
        `UPDATE document_jobs SET status = 'processing', lease_owner = ?, lease_expires_at = ?,
           next_attempt_at = NULL, last_error = NULL,
           started_at = COALESCE(started_at, ?), attempt = attempt + 1, updated_at = ?
         WHERE document_id = ?`,
      ).run(workerId, futureIso(LEASE_MS), timestamp, timestamp, job.documentId);
      (job as JobRow & { workerId: string }).workerId = workerId;
      job.attempt += 1;
    }
    return candidates;
  }) as Array<JobRow & { workerId: string }>;
}

function heartbeat(documentId: string, workerId: string) {
  const timestamp = now();
  return renewDocumentLease(getSqlite(), documentId, workerId, timestamp, futureIso(LEASE_MS));
}

function nextRun(documentId: string) {
  const timestamp = now();
  return getSqlite().prepare(
    `SELECT id, page_id AS pageId, page_number AS pageNumber, attempt
     FROM extraction_runs
     WHERE document_id = ? AND status <> 'complete'
       AND status <> 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY page_number LIMIT 1`,
  ).get(documentId, timestamp) as RunRow | undefined;
}

async function finishDocument(job: JobRow & { workerId: string }) {
  const finalize = await import("../app/api/documents/[documentId]/finalize/route");
  const response = await finalize.POST(
    new Request("http://local/api/finalize", {
      method: "POST",
      headers: { "oai-authenticated-user-id": job.ownerId, "x-extraction-worker-id": job.workerId },
    }),
    { params: Promise.resolve({ documentId: job.documentId }) },
  );
  await response.json();
}

async function processJob(job: JobRow & { workerId: string }) {
  const beat = setInterval(() => { heartbeat(job.documentId, job.workerId); }, HEARTBEAT_MS);
  beat.unref?.();
  let currentRun: RunRow | undefined;
  try {
    while (true) {
      if (!heartbeat(job.documentId, job.workerId)) return;
      const remaining = getSqlite().prepare(
        "SELECT COUNT(*) AS count FROM extraction_runs WHERE document_id = ? AND status <> 'complete'",
      ).get(job.documentId) as { count: number };
      if (!remaining.count) {
        await finishDocument(job);
        return;
      }
      const run = nextRun(job.documentId);
      currentRun = run;
      if (!run) {
        const waiting = getSqlite().prepare(
          `SELECT MIN(next_attempt_at) AS nextAttemptAt FROM extraction_runs
           WHERE document_id = ? AND status = 'retry_wait'`,
        ).get(job.documentId) as { nextAttemptAt: string | null };
        const failed = getSqlite().prepare(
          "SELECT error FROM extraction_runs WHERE document_id = ? AND status = 'failed' ORDER BY page_number LIMIT 1",
        ).get(job.documentId) as { error: string } | undefined;
        const timestamp = now();
        sqliteTransaction((transaction) => {
          assertDocumentLease(transaction, job.documentId, job.workerId, timestamp);
          const changed = transaction.prepare(
            `UPDATE document_jobs SET status = ?, next_attempt_at = ?, lease_owner = NULL,
               lease_expires_at = NULL, last_error = ?, updated_at = ?, finished_at = ?
             WHERE document_id = ? AND lease_owner = ?`,
          ).run(
            failed ? "failed" : "retry_wait", waiting.nextAttemptAt,
            failed?.error ?? null, timestamp, failed ? timestamp : null, job.documentId, job.workerId,
          );
          if (failed && changed.changes === 1) {
            transaction.prepare("UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
              .run(failed.error, timestamp, job.documentId);
          }
        });
        return;
      }
      const document = getSqlite().prepare("SELECT name FROM documents WHERE id = ?").get(job.documentId) as { name: string };
      const extract = await import("../app/api/extract/route");
      const response = await extract.POST(new Request("http://local/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json", "oai-authenticated-user-id": job.ownerId },
        body: JSON.stringify({
          documentId: job.documentId,
          pageId: run.pageId,
          pageNumber: run.pageNumber,
          fileName: document.name,
          profileId: job.profileId ?? undefined,
          workerId: job.workerId,
        }),
      }));
      if (response.ok) continue;
      const failure = await response.json() as ExtractionFailure;
      if (failure.code === "lease_lost" || !heartbeat(job.documentId, job.workerId)) return;
      // Some failures (for example decrypting the model credential) happen before
      // the page run is activated, so its attempt can remain zero. The document
      // job attempt is the durable retry clock and prevents an infinite retry loop.
      const attempt = effectiveExtractionAttempt(run.attempt, job.attempt);
      const retryable = failure.retryable !== false && !shouldPauseExtraction(attempt);
      const timestamp = now();
      const message = (failure.error ?? "页面识别失败").slice(0, 4000);
      if (retryable) {
        const nextAttemptAt = futureIso(retryDelayMs(attempt, failure.retryAfterMs));
        sqliteTransaction((transaction) => {
          assertDocumentLease(transaction, job.documentId, job.workerId, timestamp);
          transaction.prepare(
            `UPDATE extraction_runs SET status = 'retry_wait', error = ?, error_code = ?,
               next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?
             WHERE document_id = ? AND page_number = ?`,
          ).run(message, failure.code ?? "extraction_error", nextAttemptAt, timestamp, job.documentId, run.pageNumber);
          transaction.prepare(
            `UPDATE document_jobs SET status = 'retry_wait', next_attempt_at = ?, lease_owner = NULL,
               lease_expires_at = NULL, last_error = ?, updated_at = ?
             WHERE document_id = ? AND lease_owner = ?`,
          ).run(nextAttemptAt, `第 ${run.pageNumber} 页：${message}`, timestamp, job.documentId, job.workerId);
          transaction.prepare("UPDATE documents SET status = 'extracting', error = ?, updated_at = ? WHERE id = ?")
            .run(`第 ${run.pageNumber} 页将在 ${nextAttemptAt} 自动重试：${message}`.slice(0, 4000), timestamp, job.documentId);
        });
      } else {
        sqliteTransaction((transaction) => {
          assertDocumentLease(transaction, job.documentId, job.workerId, timestamp);
          transaction.prepare(
            `UPDATE extraction_runs SET status = 'failed', error = ?, error_code = ?,
               next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?
             WHERE document_id = ? AND page_number = ?`,
          ).run(message, failure.code ?? "extraction_error", timestamp, job.documentId, run.pageNumber);
          transaction.prepare(
            `UPDATE document_jobs SET status = 'failed', next_attempt_at = NULL, lease_owner = NULL,
               lease_expires_at = NULL, last_error = ?, finished_at = ?, updated_at = ?
             WHERE document_id = ? AND lease_owner = ?`,
          ).run(`第 ${run.pageNumber} 页：${message}`, timestamp, timestamp, job.documentId, job.workerId);
          transaction.prepare("UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
            .run(`第 ${run.pageNumber} 页：${message}`.slice(0, 4000), timestamp, job.documentId);
        });
      }
      return;
    }
  } catch (error) {
    if (error instanceof LostDocumentLeaseError || !heartbeat(job.documentId, job.workerId)) return;
    const message = error instanceof Error ? error.message : "队列工作进程异常";
    const timestamp = now();
    const attempt = job.attempt;
    const paused = shouldPauseExtraction(attempt);
    sqliteTransaction((transaction) => {
      assertDocumentLease(transaction, job.documentId, job.workerId, timestamp);
      if (paused) {
        transaction.prepare(
          `UPDATE extraction_runs SET status = 'failed', error = ?, error_code = 'worker_error',
             next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?
           WHERE document_id = ? AND status <> 'complete'`,
        ).run(message.slice(0, 4000), timestamp, job.documentId);
        transaction.prepare(
          `UPDATE document_jobs SET status = 'failed', next_attempt_at = NULL, lease_owner = NULL,
             lease_expires_at = NULL, last_error = ?, finished_at = ?, updated_at = ?
           WHERE document_id = ? AND lease_owner = ?`,
        ).run(message.slice(0, 4000), timestamp, timestamp, job.documentId, job.workerId);
        transaction.prepare("UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
          .run(`连续 ${MAX_EXTRACTION_ATTEMPTS} 次处理失败，任务已暂停：${message}`.slice(0, 4000), timestamp, job.documentId);
      } else {
        const nextAttemptAt = futureIso(retryDelayMs(attempt));
        if (currentRun) {
          transaction.prepare(
            `UPDATE extraction_runs SET status = 'retry_wait', error = ?, error_code = 'worker_error',
               next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?
             WHERE id = ? AND status <> 'complete'`,
          ).run(message.slice(0, 4000), nextAttemptAt, timestamp, currentRun.id);
        }
        transaction.prepare(
          `UPDATE document_jobs SET status = 'retry_wait', next_attempt_at = ?, lease_owner = NULL,
             lease_expires_at = NULL, last_error = ?, updated_at = ?
           WHERE document_id = ? AND lease_owner = ?`,
        ).run(nextAttemptAt, message.slice(0, 4000), timestamp, job.documentId, job.workerId);
        transaction.prepare("UPDATE documents SET status = 'extracting', error = ?, updated_at = ? WHERE id = ?")
          .run(`处理异常，将在 ${nextAttemptAt} 自动重试：${message}`.slice(0, 4000), timestamp, job.documentId);
      }
    });
  } finally {
    clearInterval(beat);
  }
}

async function pump() {
  await ensureDatabase();
  const jobs = claimJobs();
  if (jobs.length) {
    for (const job of jobs) {
      void processJob(job).finally(() => schedulePump(25));
    }
    return;
  }
  const next = getSqlite().prepare(
    `SELECT MIN(next_attempt_at) AS nextAttemptAt FROM document_jobs
     WHERE status = 'retry_wait' AND next_attempt_at IS NOT NULL`,
  ).get() as { nextAttemptAt: string | null };
  const lease = getSqlite().prepare(
    `SELECT MIN(lease_expires_at) AS leaseExpiresAt FROM document_jobs
     WHERE status = 'processing' AND lease_expires_at IS NOT NULL`,
  ).get() as { leaseExpiresAt: string | null };
  const queued = getSqlite().prepare(
    "SELECT COUNT(*) AS count FROM document_jobs WHERE status = 'queued'",
  ).get() as { count: number };
  if (queued.count) schedulePump(25);
  else {
    const wakeTimes = [next.nextAttemptAt, lease.leaseExpiresAt].filter(Boolean).map((value) => Date.parse(value!));
    if (wakeTimes.length) schedulePump(Math.min(30_000, Math.max(25, Math.min(...wakeTimes) - Date.now())));
  }
}

export async function kickExtractionQueue() {
  if (global.__teacherDbQueuePump) return global.__teacherDbQueuePump;
  global.__teacherDbQueuePump = pump().finally(() => {
    global.__teacherDbQueuePump = undefined;
  });
  return global.__teacherDbQueuePump;
}
