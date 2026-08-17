import { searchApprovedQuestions } from "../../../lib/question-repository";
import { sqliteTransaction } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { deleteFile } from "../../../lib/file-storage";
import { deleteQuestions, normalizeQuestionIds, QuestionBulkActionError } from "../../../lib/question-bulk-actions";
import { now, requestOwner } from "../../../lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year")) || undefined;
  const result = await searchApprovedQuestions(requestOwner(request), {
    query: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    documentId: url.searchParams.get("documentId") ?? undefined,
    subject: url.searchParams.get("subject") ?? undefined,
    grade: url.searchParams.get("grade") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    year,
    examType: url.searchParams.get("examType") ?? undefined,
    region: url.searchParams.get("region") ?? undefined,
    school: url.searchParams.get("school") ?? undefined,
    page: Number(url.searchParams.get("page")) || 1,
    pageSize: Number(url.searchParams.get("pageSize")) || 30,
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  await ensureDatabase();
  try {
    const payload = await request.json().catch(() => ({})) as { ids?: unknown };
    const questionIds = normalizeQuestionIds(payload.ids);
    const outcome = sqliteTransaction((transaction) => deleteQuestions(transaction, {
      ownerId: requestOwner(request),
      questionIds,
      timestamp: now(),
    }));
    const cleanup = await Promise.allSettled(outcome.fileKeys.map((key) => deleteFile(key)));
    return Response.json({
      deleted: outcome.deleted,
      fileCleanupFailures: cleanup.filter((result) => result.status === "rejected").length,
    });
  } catch (error) {
    const status = error instanceof QuestionBulkActionError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "题目删除失败" }, { status });
  }
}
