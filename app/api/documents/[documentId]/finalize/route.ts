import { getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { now, requestOwner } from "../../../../../lib/server";
import { getDocumentIntegrity, integrityError } from "../../../../../lib/document-integrity";
import { assertDocumentLease, LostDocumentLeaseError } from "../../../../../lib/job-lease";
import { finalizeDocumentState, unresolvedAnswerUpdateNumbers } from "../../../../../lib/document-finalization";

export const runtime = "nodejs";

type AnswerUpdate = { number?: unknown; answer?: unknown; analysis?: unknown; confidence?: unknown; needsHumanReview?: unknown };
type RunPayload = {
  answerUpdates?: AnswerUpdate[];
  _pipeline?: { unmatchedAnswerUpdateNumbers?: unknown[] };
};

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const workerId = request.headers.get("x-extraction-worker-id")?.trim() || null;
  const sqlite = getSqlite();
  const document = sqlite.prepare("SELECT id FROM documents WHERE id = ? AND owner_id = ?").get(documentId, ownerId);
  if (!document) return Response.json({ error: "文档不存在" }, { status: 404 });
  const activeJob = sqlite.prepare(
    "SELECT status, lease_owner AS leaseOwner FROM document_jobs WHERE document_id = ?",
  ).get(documentId) as { status: string; leaseOwner: string | null } | undefined;
  if (activeJob?.status === "processing" && !workerId) {
    return Response.json({ error: "识别任务仍在运行，只有持有当前租约的 worker 可以收尾", code: "worker_required" }, { status: 409 });
  }
  if (workerId) {
    try { assertDocumentLease(sqlite, documentId, workerId, now()); }
    catch (error) {
      if (error instanceof LostDocumentLeaseError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
      throw error;
    }
  }
  const runs = sqlite.prepare(
    `SELECT page_number AS pageNumber, status, raw_json AS rawJson, error
       FROM extraction_runs
      WHERE document_id = ? AND (idempotency_key LIKE ? OR idempotency_key LIKE ?)
      ORDER BY page_number`,
  ).all(documentId, `${documentId}:page:%:extract-v4`, `${documentId}:page:%:extract-v3`) as Array<{ pageNumber: number; status: string; rawJson: string | null; error: string | null }>;
  const updates: AnswerUpdate[] = [];
  const pipelineUnmatchedNumbers: string[] = [];
  for (const run of runs) {
    if (run.status !== "complete" || !run.rawJson) continue;
    try {
      const parsed = JSON.parse(run.rawJson) as RunPayload;
      if (Array.isArray(parsed.answerUpdates)) updates.push(...parsed.answerUpdates);
      if (Array.isArray(parsed._pipeline?.unmatchedAnswerUpdateNumbers)) {
        pipelineUnmatchedNumbers.push(...parsed._pipeline.unmatchedAnswerUpdateNumbers.map(String));
      }
    } catch {
      // 单页原始结果已在识别接口中验证；这里忽略历史损坏记录并保留可审核题目。
    }
  }
  const integrity = getDocumentIntegrity(sqlite, documentId)!;
  const totalPages = integrity.pageCount;
  const storedPages = integrity.storedPageNumbers.length;
  const completePages = integrity.completedPageNumbers.length;
  const failedRuns = runs.filter((run) => run.status === "failed");
  const existingQuestionNumbers = new Set(
    (sqlite.prepare("SELECT number FROM questions WHERE document_id = ?").all(documentId) as Array<{ number: string }>)
      .map((question) => question.number),
  );
  // Earlier pages can report an answer as unmatched before a later page creates
  // that question. Reconcile every historical hint against the final question
  // table instead of treating a transient page-level result as a terminal error.
  const unmatchedAnswerUpdateNumbers = unresolvedAnswerUpdateNumbers(
    pipelineUnmatchedNumbers,
    updates.map((update) => update.number),
    existingQuestionNumbers,
  );
  const integrityFailure = failedRuns.length
    ? null
    : unmatchedAnswerUpdateNumbers.length
      ? `识别结果包含第 ${unmatchedAnswerUpdateNumbers.join("、")} 题的答案或解析，但题目主体未成功落库，请重新进行整卷识别`
      : integrity.reviewReady ? null : integrityError(integrity);
  const terminalError = failedRuns.length
    ? `整卷识别失败：${failedRuns[0]?.error ?? "识别失败"}`.slice(0, 4000)
    : integrityFailure;
  const timestamp = now();
  try {
    sqliteTransaction((transaction) => {
    if (workerId) assertDocumentLease(transaction, documentId, workerId, timestamp);
    // Each page transaction has already normalized and applied its answer updates.
    // Replaying raw model JSON here can overwrite a repaired question with stale or
    // historically misnumbered content, so finalization is deliberately state-only.
    finalizeDocumentState(transaction, { documentId, terminalError, timestamp });
    });
  } catch (error) {
    if (error instanceof LostDocumentLeaseError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
    throw error;
  }
  const payload = {
    totalPages,
    storedPages,
    completePages,
    failedPages: failedRuns.length,
    missingPageNumbers: integrity.missingPageNumbers,
    unexpectedPageNumbers: integrity.unexpectedPageNumbers,
    incompletePageNumbers: integrity.incompletePageNumbers,
    missingQuestionNumbers: integrity.missingQuestionNumbers,
    invalidQuestionNumbers: integrity.invalidQuestionNumbers,
    unmatchedAnswerUpdateNumbers,
    answerUpdatesAlreadyApplied: updates.length,
    ...(terminalError ? { error: terminalError } : {}),
  };
  return Response.json(payload, { status: terminalError ? 409 : 200 });
}
