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
    `SELECT p.id AS pageId, p.page_number AS pageNumber, COALESCE(r.status, 'queued') AS status,
            COALESCE(r.attempt, 0) AS attempt, r.error, r.next_attempt_at AS nextAttemptAt,
            r.created_at AS startedAt, r.finished_at AS finishedAt
       FROM pages p LEFT JOIN extraction_runs r
         ON r.idempotency_key = p.document_id || ':page:' || p.page_number || ':extract-v3'
      WHERE p.document_id = ? ORDER BY p.page_number`,
  ).all(documentId) as Array<{
    pageId: string; pageNumber: number; status: string; attempt: number; error: string | null;
    startedAt: string | null; finishedAt: string | null;
  }>;
  const counts = pageRows.reduce((result, page) => {
    result[page.status] = (result[page.status] ?? 0) + 1;
    return result;
  }, {} as Record<string, number>);
  const job = sqlite.prepare(
    `SELECT status, next_attempt_at AS nextAttemptAt, last_error AS lastError,
       queued_at AS queuedAt, started_at AS startedAt, finished_at AS finishedAt
     FROM document_jobs WHERE document_id = ?`,
  ).get(documentId);
  return Response.json({ document, job, counts, pages: pageRows }, { headers: { "cache-control": "no-store" } });
}
