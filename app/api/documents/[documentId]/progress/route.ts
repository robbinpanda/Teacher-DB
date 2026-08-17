import { getSqlite } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { requestOwner } from "../../../../../lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const sqlite = getSqlite();
  const document = sqlite.prepare(
    "SELECT id, status, error, page_count AS pageCount, updated_at AS updatedAt FROM documents WHERE id = ? AND owner_id = ?",
  ).get(documentId, requestOwner(request)) as { id: string; status: string; error: string | null; pageCount: number; updatedAt: string } | undefined;
  if (!document) return Response.json({ error: "文档不存在" }, { status: 404 });
  const pageRows = sqlite.prepare(
    `SELECT p.id AS pageId, p.page_number AS pageNumber, p.storage_key AS storageKey, p.width, p.height,
            COALESCE(r.status, 'queued') AS status,
            COALESCE(r.attempt, 0) AS attempt, r.error, r.next_attempt_at AS nextAttemptAt,
            r.created_at AS startedAt, r.finished_at AS finishedAt
       FROM pages p LEFT JOIN extraction_runs r
         ON r.id = (
           SELECT latest.id FROM extraction_runs latest
            WHERE latest.document_id = p.document_id AND latest.page_number = p.page_number
            ORDER BY latest.created_at DESC, latest.rowid DESC LIMIT 1
         )
      WHERE p.document_id = ? ORDER BY p.page_number`,
  ).all(documentId) as Array<{
    pageId: string; pageNumber: number; storageKey: string; width: number; height: number; status: string; attempt: number; error: string | null;
    startedAt: string | null; finishedAt: string | null;
  }>;
  const counts = pageRows.reduce((result, page) => {
    result[page.status] = (result[page.status] ?? 0) + 1;
    return result;
  }, {} as Record<string, number>);
  const job = sqlite.prepare(
    `SELECT status, next_attempt_at AS nextAttemptAt, last_error AS lastError,
       queued_at AS queuedAt, started_at AS startedAt, finished_at AS finishedAt,
       question_total AS questionTotal, completed_question_numbers_json AS completedQuestionNumbersJson,
       stream_phase AS streamPhase, last_stream_event_at AS lastStreamEventAt,
       stream_message AS streamMessage
     FROM document_jobs WHERE document_id = ?`,
  ).get(documentId) as {
    status: string; nextAttemptAt: string | null; lastError: string | null;
    questionTotal: number | null; completedQuestionNumbersJson: string | null;
    streamPhase: string | null; lastStreamEventAt: string | null; streamMessage: string | null;
  } | undefined;
  let completedQuestionNumbers: string[] = [];
  try {
    const parsed = JSON.parse(job?.completedQuestionNumbersJson ?? "[]");
    if (Array.isArray(parsed)) completedQuestionNumbers = parsed.map(String).filter((value) => /^[1-9]\d*$/.test(value));
  } catch {
    completedQuestionNumbers = [];
  }
  completedQuestionNumbers.sort((left, right) => Number(left) - Number(right));
  const questionTotal = job?.questionTotal ?? null;
  const terminalPhase = job && ["paused", "failed", "retry_wait", "complete"].includes(job.status)
    ? job.status
    : null;
  const recognition = {
    questionTotal,
    completedQuestionNumbers,
    completedQuestionCount: completedQuestionNumbers.length,
    percent: questionTotal ? Math.min(100, Math.round(completedQuestionNumbers.length / questionTotal * 100)) : 0,
    phase: terminalPhase ?? job?.streamPhase ?? job?.status ?? "queued",
    lastEventAt: job?.lastStreamEventAt ?? null,
    message: job?.streamMessage ?? null,
  };
  const responsePages = pageRows.map(({ storageKey, ...page }) => ({
    ...page,
    imageUrl: "/api/files/" + storageKey.split("/").map(encodeURIComponent).join("/"),
  }));
  return Response.json({ document, job, recognition, counts, pages: responsePages }, { headers: { "cache-control": "no-store" } });
}
