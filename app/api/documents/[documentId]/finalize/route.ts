import { getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { now, requestOwner } from "../../../../../lib/server";
import { modelNeedsHumanReview } from "../../../../../lib/model-review";
import { getDocumentIntegrity, integrityError } from "../../../../../lib/document-integrity";

export const runtime = "nodejs";

type AnswerUpdate = { number?: unknown; answer?: unknown; analysis?: unknown; confidence?: unknown; needsHumanReview?: unknown };

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const sqlite = getSqlite();
  const document = sqlite.prepare("SELECT id FROM documents WHERE id = ? AND owner_id = ?").get(documentId, ownerId);
  if (!document) return Response.json({ error: "文档不存在" }, { status: 404 });
  const runs = sqlite.prepare(
    `SELECT page_number AS pageNumber, status, raw_json AS rawJson, error
       FROM extraction_runs
      WHERE document_id = ? AND idempotency_key LIKE ?
      ORDER BY page_number`,
  ).all(documentId, `${documentId}:page:%:extract-v3`) as Array<{ pageNumber: number; status: string; rawJson: string | null; error: string | null }>;
  const updates: AnswerUpdate[] = [];
  for (const run of runs) {
    if (run.status !== "complete" || !run.rawJson) continue;
    try {
      const parsed = JSON.parse(run.rawJson) as { answerUpdates?: AnswerUpdate[] };
      if (Array.isArray(parsed.answerUpdates)) updates.push(...parsed.answerUpdates);
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
  const unmatchedAnswerUpdateNumbers = Array.from(new Set(
    updates.map((update) => String(update.number ?? "").trim())
      .filter((number) => /^\d+$/.test(number) && !existingQuestionNumbers.has(number)),
  )).sort((left, right) => Number(left) - Number(right));
  const integrityFailure = failedRuns.length
    ? null
    : unmatchedAnswerUpdateNumbers.length
      ? `识别结果包含第 ${unmatchedAnswerUpdateNumbers.join("、")} 题的答案或解析，但题目主体未成功落库，请重新识别对应页面后再审核`
      : integrity.reviewReady ? null : integrityError(integrity);
  const terminalError = failedRuns.length
    ? failedRuns.map((run) => `第 ${run.pageNumber} 页：${run.error ?? "识别失败"}`).join("\n").slice(0, 4000)
    : integrityFailure;
  const timestamp = now();
  sqliteTransaction((transaction) => {
    for (const update of updates) {
      const number = String(update.number ?? "").trim();
      const answer = String(update.answer ?? "");
      const analysis = String(update.analysis ?? "");
      if (!number || (!answer && !analysis)) continue;
      const confidence = Math.max(0, Math.min(1, Number(update.confidence ?? 0)));
      const needsHumanReview = modelNeedsHumanReview(update.needsHumanReview);
      transaction.prepare(
        `UPDATE questions SET answer = CASE WHEN ? <> '' THEN ? ELSE answer END,
           analysis = CASE WHEN ? <> '' THEN ? ELSE analysis END,
           needs_human_review = CASE WHEN needs_human_review = 1 OR ? = 1 THEN 1 ELSE 0 END,
           status = CASE WHEN status = 'approved' THEN status WHEN needs_human_review = 1 OR ? = 1 THEN 'needs_attention' ELSE 'pending' END,
           confidence = max(confidence, ?), updated_at = ?
         WHERE document_id = ? AND number = ?`,
      ).run(answer, answer, analysis, analysis, needsHumanReview ? 1 : 0, needsHumanReview ? 1 : 0, confidence, timestamp, documentId, number);
    }
    const status = terminalError ? "failed" : "reviewing";
    transaction.prepare("UPDATE documents SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(status, terminalError, timestamp, documentId);
    transaction.prepare(
      `UPDATE document_jobs SET status = ?, next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
         last_error = ?, finished_at = ?, updated_at = ? WHERE document_id = ?`,
    ).run(terminalError ? "failed" : "complete", terminalError, timestamp, timestamp, documentId);
  });
  const payload = {
    totalPages,
    storedPages,
    completePages,
    failedPages: failedRuns.length,
    missingPageNumbers: integrity.missingPageNumbers,
    unexpectedPageNumbers: integrity.unexpectedPageNumbers,
    incompletePageNumbers: integrity.incompletePageNumbers,
    missingQuestionNumbers: integrity.missingQuestionNumbers,
    unmatchedAnswerUpdateNumbers,
    answerUpdatesApplied: updates.length,
    ...(terminalError ? { error: terminalError } : {}),
  };
  return Response.json(payload, { status: terminalError ? 409 : 200 });
}
