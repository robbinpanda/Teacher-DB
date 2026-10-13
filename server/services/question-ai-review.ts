import { getSqlite, sqliteTransaction } from "../../db";
import { contentTypeForKey, getFile } from "../../lib/file-storage";
import sharp from "sharp";
import { callVisionModel } from "../../lib/vision-model";
import { parseQuestionReview, QUESTION_REVIEW_MAX_TOKENS, QUESTION_REVIEW_PROMPT, questionReviewText } from "../../lib/question-ai-review";
import type { Question, QuestionAiReview, QuestionAsset, QuestionReviewCategory } from "../../lib/types";
import { assertDocumentLease } from "../../lib/job-lease";
import type { ModelCallTrace } from "../../lib/model-call-trace";

export function loadQuestionForAiReview(ownerId: string, questionId: string) {
  const sqlite = getSqlite();
  const row = sqlite.prepare(`SELECT q.*, d.page_count AS pageCount, d.source_removed_at AS sourceRemovedAt,
    d.id AS documentId FROM questions q JOIN documents d ON d.id=q.document_id WHERE q.id=? AND d.owner_id=?`)
    .get(questionId, ownerId) as { id: string; number: string; type: Question["type"]; stem: string; answer: string; analysis: string;
      options_json: string; page_number: number; bbox_json: string; status: Question["status"]; needs_human_review: number;
      ai_review_json: string | null; extraction_issues_json: string; missing_images_json: string;
      pageCount: number; sourceRemovedAt: string | null; documentId: string } | undefined;
  if (!row) return null;
  const assets = sqlite.prepare(`SELECT a.id, a.kind, a.role, a.label, a.crop_key AS cropKey, a.bbox_json AS bboxJson,
    COALESCE(p.page_number,?) AS page FROM question_assets a LEFT JOIN pages p ON p.id=a.page_id
    WHERE a.question_id=? ORDER BY a.position, a.created_at, a.id`).all(row.page_number, questionId) as Array<Omit<QuestionAsset, "bbox"> & { bboxJson: string }>;
  const question: Question = { id: row.id, number: row.number, type: row.type, stem: row.stem, answer: row.answer, analysis: row.analysis,
    options: JSON.parse(row.options_json || "[]"), page: row.page_number, bbox: JSON.parse(row.bbox_json), regions: [], tags: [], confidence: 0,
    status: row.status, needsHumanReview: row.needs_human_review !== 0, assets: assets.map(({ bboxJson, ...asset }) => ({ ...asset, bbox: JSON.parse(bboxJson) })),
    aiReview: row.ai_review_json ? JSON.parse(row.ai_review_json) : null,
    extractionIssues: JSON.parse(row.extraction_issues_json), missingImages: JSON.parse(row.missing_images_json) };
  return { question, documentId: row.documentId, pageCount: row.pageCount, sourceRemovedAt: row.sourceRemovedAt };
}

/** Pin each independent review to its extraction model, never the current default or old reviewer. */
function reviewProfile(ownerId: string, documentId: string, review: QuestionAiReview) {
  const sqlite = getSqlite();
  const extraction = review.extractionProfileId
    ? { profileId: review.extractionProfileId, model: review.extractionModel }
    : sqlite.prepare(`SELECT r.model_profile_id AS profileId, r.model FROM extraction_runs r
        JOIN documents d ON d.id=r.document_id WHERE d.id=? AND d.owner_id=?
        AND r.status='complete' AND r.model_profile_id IS NOT NULL ORDER BY r.created_at DESC, r.id DESC LIMIT 1`)
      .get(documentId, ownerId) as { profileId: string; model: string } | undefined;
  if (!extraction) throw new Error("无法确定本题的识别模型，请重新识别后复核");
  const profile = sqlite.prepare("SELECT id, model FROM model_profiles WHERE id=? AND owner_id=? AND enabled=1")
    .get(extraction.profileId, ownerId) as { id: string; model: string } | undefined;
  if (!profile) throw new Error("本题的识别模型配置不存在或已停用，请恢复后复核");
  if (extraction.model && profile.model !== extraction.model) throw new Error("本题的识别模型配置已更换模型，请恢复原模型或重新识别后复核");
  return profile;
}

/** Isolated, fail-closed review. CAS protects teacher edits, deletion and newer extraction runs. */
export async function reviewExtractedQuestion(input: {
  ownerId: string; documentId: string; question: Question; workerId?: string;
}) {
  const { question, ownerId, documentId } = input;
  const review = question.aiReview;
  if (!review || review.status !== "pending") return;
  const sqlite = getSqlite();
  const expectedJson = JSON.stringify(review);
  const row = sqlite.prepare(`SELECT q.updated_at AS updatedAt FROM questions q JOIN documents d ON d.id=q.document_id
    WHERE q.id=? AND q.document_id=? AND d.owner_id=?
      AND q.status<>'approved' AND q.ai_review_json=?`).get(question.id, documentId, ownerId, expectedJson) as { updatedAt: string } | undefined;
  if (!row) return;
  let outcome: QuestionAiReview;
  let trace: ModelCallTrace | undefined;
  try {
    if (input.workerId) assertDocumentLease(sqlite, documentId, input.workerId, new Date().toISOString());
    const saved = loadQuestionForAiReview(ownerId, question.id)!.question;
    const knownIssues: QuestionReviewCategory[] = [];
    if (!saved.stem.trim()) knownIssues.push("缺条件");
    if (saved.missingImages?.length) knownIssues.push("缺图");
    const images: Array<{ page: number; dataUrl: string; label: string }> = [];
    for (const [index, asset] of saved.assets.entries()) {
      if (!asset.cropKey) { knownIssues.push("缺图"); continue; }
      let bytes: Buffer;
      try { bytes = await getFile(asset.cropKey); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        knownIssues.push("缺图"); continue;
      }
      try { await sharp(bytes, { failOn: "error" }).stats(); }
      catch { knownIssues.push("配图错误"); continue; }
      images.push({ page: index + 1, label: `已保存配图 ${index + 1}（${asset.role === "question" ? "题干" : "解析"}）：`,
        dataUrl: `data:${contentTypeForKey(asset.cropKey)};base64,${bytes.toString("base64")}` });
    }
    const profile = reviewProfile(ownerId, documentId, review);
    const response = await callVisionModel({ ownerId, documentId, profileId: profile.id,
      purpose: "question_review", pageCount: images.length, pageNumber: question.page,
      system: QUESTION_REVIEW_PROMPT, text: questionReviewText(saved), images,
      maxOutputTokens: QUESTION_REVIEW_MAX_TOKENS, timeoutMs: 60_000, onTrace: value => { trace = value; } });
    const verdict = parseQuestionReview(response.content);
    const categories = [...new Set([...knownIssues, ...verdict.categories])];
    outcome = { ...review, mode: "saved_content_v1", extractionProfileId: profile.id, extractionModel: profile.model, categories, status: categories.length ? "issues" : "passed", traceId: response.traceId,
      profileId: response.profile.id, reviewedAt: new Date().toISOString() };
    trace?.validation("complete", { questionId: question.id, number: question.number, verdict: outcome.status, categories });
  } catch (error) {
    outcome = { ...review, mode: "saved_content_v1", categories: [], status: "failed", traceId: trace?.id, error: error instanceof Error ? error.message : "AI 审核失败",
      reviewedAt: new Date().toISOString() };
    trace?.validation("failed", { questionId: question.id, number: question.number, error: outcome.error });
  }
  sqliteTransaction(transaction => {
    // A lost lease must not publish even a failure over a newer worker's result.
    if (input.workerId) assertDocumentLease(transaction, documentId, input.workerId, new Date().toISOString());
    const current = transaction.prepare(`SELECT extraction_issues_json AS issues, missing_images_json AS missing FROM questions
      WHERE id=? AND updated_at=? AND ai_review_json=? AND status<>'approved'
        AND document_id IN (SELECT id FROM documents WHERE id=? AND owner_id=?)`)
      .get(question.id, row.updatedAt, expectedJson, documentId, ownerId) as { issues: string; missing: string } | undefined;
    if (!current) return;
    const needsReview = outcome.status !== "passed" || (review.priorNeedsHumanReview ?? question.needsHumanReview) || current.issues !== "[]" || current.missing !== "[]";
    transaction.prepare("UPDATE questions SET ai_review_json=?, needs_human_review=?, status=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(outcome), needsReview ? 1 : 0, needsReview ? "needs_attention" : "pending", new Date().toISOString(), question.id);
    question.aiReview = outcome;
    question.needsHumanReview = needsReview;
    question.status = needsReview ? "needs_attention" : "pending";
  });
}
