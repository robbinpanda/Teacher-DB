import { ensureDatabase } from "../../../../../../db/bootstrap";
import { getSqlite } from "../../../../../../db";
import { requestOwner } from "../../../../../../lib/server";
import { createQuestionReview } from "../../../../../../lib/question-ai-review";
import { loadQuestionForAiReview, reviewExtractedQuestion } from "../../../../../services/question-ai-review";

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  await ensureDatabase();
  const { questionId } = await context.params;
  const ownerId = requestOwner(request);
  const saved = loadQuestionForAiReview(ownerId, questionId);
  if (!saved) return Response.json({ error: "题目不存在" }, { status: 404 });
  const { question, documentId } = saved;
  if (question.status === "approved") return Response.json({ error: "请先移出题库再重新审核" }, { status: 409 });
  const old = question.aiReview;
  if (old?.status === "pending" && old.startedAt && Date.now() - Date.parse(old.startedAt) < 65_000) {
    return Response.json({ error: "本题 AI 审核正在进行，请稍后重试" }, { status: 409 });
  }
  // A per-document extraction worker owns pending automatic reviews; retries must not supersede it.
  const job = getSqlite().prepare("SELECT status FROM document_jobs WHERE document_id=?").get(documentId) as { status: string } | undefined;
  if (job?.status === "processing") return Response.json({ error: "整卷识别与逐题审核仍在进行，请稍后重试" }, { status: 409 });
  question.aiReview = old ? { ...old, mode: "saved_content_v1", categories: [], status: "pending", token: crypto.randomUUID(), startedAt: new Date().toISOString(), error: undefined, traceId: undefined, reviewedAt: undefined }
    : createQuestionReview(question, { sourcePages: [question.page] }, saved.pageCount);
  getSqlite().prepare("UPDATE questions SET ai_review_json=?,needs_human_review=1,status='needs_attention' WHERE id=?")
    .run(JSON.stringify(question.aiReview), question.id);
  await reviewExtractedQuestion({ ownerId, documentId, question });
  const latest = loadQuestionForAiReview(ownerId, questionId)?.question;
  return Response.json({ aiReview: latest?.aiReview, needsHumanReview: latest?.needsHumanReview, status: latest?.status });
}
