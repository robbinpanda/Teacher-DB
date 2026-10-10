import { snapshotTeachingSkill } from "../../../../../../lib/teaching-skills";
import { getSqlite, sqliteTransaction } from "../../../../../../db";
import { ensureDatabase } from "../../../../../../db/bootstrap";
import { getFile } from "../../../../../../lib/file-storage";
import { requestOwner } from "../../../../../../lib/server";
import { callVisionModelStream } from "../../../../../../lib/vision-model";
import { detectAssetCandidates, annotateAssetCandidates } from "../../../../../../lib/asset-candidates";
import { ASSET_REVIEW_SYSTEM_PROMPT, parseCandidateSelection, type PageAssetCandidate } from "../../../../../../lib/asset-review";
import type { QuestionAsset } from "../../../../../../lib/types";
import type { ModelCallTrace } from "../../../../../../lib/model-call-trace";
import { extractionConfidence } from "../../../../../../lib/extraction-confidence";


export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  await ensureDatabase();
  const { questionId } = await context.params;
  const ownerId = requestOwner(request);
  const sqlite = getSqlite();
  const question = sqlite.prepare(`SELECT q.document_id AS documentId, q.number, q.stem, q.answer, q.analysis, q.confidence,
    d.subject, d.grade, d.source_removed_at AS removed FROM questions q JOIN documents d ON d.id=q.document_id
    WHERE q.id=? AND d.owner_id=?`).get(questionId, ownerId) as {
      subject: string | null; grade: string | null; documentId: string; number: string; stem: string; answer: string; analysis: string; confidence: number; removed: string | null;
    } | undefined;
  if (!question) return Response.json({ error: "题目不存在" }, { status: 404 });
  if (question.removed) return Response.json({ error: "原试卷已删除，无法复核图片" }, { status: 409 });
  const readAssets = () => sqlite.prepare(`SELECT a.id,a.kind,a.role,a.label,p.page_number AS page,a.bbox_json AS bbox
    FROM question_assets a JOIN pages p ON p.id=a.page_id WHERE a.question_id=? ORDER BY a.position,a.id`).all(questionId) as Array<Omit<QuestionAsset, "bbox"> & { bbox: string }>;
  const assetRows = readAssets();
  const before = JSON.stringify(assetRows);
  const existingAssets: QuestionAsset[] = assetRows.map((a) => ({ ...a, bbox: JSON.parse(a.bbox) }));
  const sourcePages = sqlite.prepare("SELECT page_number AS page, storage_key AS storageKey FROM pages WHERE document_id=? ORDER BY page_number")
    .all(question.documentId) as Array<{ page: number; storageKey: string }>;
  if (!sourcePages.length || sourcePages.length > 60) return Response.json({ error: "图片复核支持 1–60 页原卷" }, { status: 422 });
  let trace: ModelCallTrace | undefined;
  try {
    const candidates: PageAssetCandidate[] = [];
    const images: Array<{ page: number; dataUrl: string }> = [];
    let totalBytes = 0;
    for (const page of sourcePages) {
      const bytes = await getFile(page.storageKey);
      totalBytes += bytes.length;
      if (totalBytes > 120 * 1024 * 1024) throw new Error("原卷图片超过复核大小限制");
      const found = await detectAssetCandidates(bytes);
      const pageCandidates = found.candidates.map((c) => ({ ...c, id: `p${page.page}-${c.id}` }));
      const existingCandidates = existingAssets.flatMap((asset, index) => asset.page !== page.page ? [] : [{
        id: `existing:${asset.id}`, displayLabel: `E${index + 1}`, x: asset.bbox.x / 100 * found.width,
        y: asset.bbox.y / 100 * found.height, width: asset.bbox.width / 100 * found.width, height: asset.bbox.height / 100 * found.height,
      }]);
      pageCandidates.push(...existingCandidates);
      candidates.push(...pageCandidates.map((c) => ({ ...c, page: page.page, pageWidth: found.width, pageHeight: found.height })));
      const annotated = await annotateAssetCandidates(bytes, pageCandidates);
      images.push({ page: page.page, dataUrl: `data:image/jpeg;base64,${annotated.toString("base64")}` });
    }
    const teachingSkill = await snapshotTeachingSkill(ownerId, question.subject || "数学", question.grade || "", question.documentId, `assets:${questionId}:${crypto.randomUUID()}`);
    const result = await callVisionModelStream({
      ownerId, documentId: question.documentId, purpose: "question_reextract", pageCount: images.length, images,
      system: `${teachingSkill.content}\n${ASSET_REVIEW_SYSTEM_PROMPT}`,
      text: JSON.stringify({ questionNumber: question.number, stem: question.stem, answer: question.answer, analysis: question.analysis,
        previousConfidence: question.confidence,
        existingAssets: existingAssets.map((a, index) => ({ ...a, displayLabel: `E${index + 1}`, selectionId: `existing:${a.id}` })),
        candidates: candidates.map((c) => ({ id: c.id, page: c.page })),
        instructions: "绿色 E 编号表示已有图片，对照 existingAssets 的 displayLabel 与 selectionId 作出逐张保留或删除决定。紫色框是新候选。检查文字/公式误框、重复内容及邻题图；删除时写具体理由。不要因为已有图或上一轮评分高就迁就旧结果。" }),
    }, { onTextDelta: () => {}, onTrace: (value) => { trace = value; } });
    const review = parseCandidateSelection(result.content, candidates, sourcePages.map((p) => p.page), { existingAssets, previousConfidence: question.confidence });
    let stale = false;
    let savedConfidence = review.confidence;
    let savedNeedsReview = review.needsHumanReview;
    let savedMissing = review.missingImages;
    sqliteTransaction((transaction) => {
      const current = transaction.prepare(`SELECT q.confidence,q.needs_human_review AS needsHumanReview,q.missing_images_json AS issues,d.source_removed_at AS removed
        FROM questions q JOIN documents d ON d.id=q.document_id WHERE q.id=?`).get(questionId) as { confidence: number; needsHumanReview: number; issues: string; removed: string | null } | undefined;
      if (!current || current.removed || JSON.stringify(readAssets()) !== before) { stale = true; return; }
      // A later successful check must not silently dismiss an earlier unresolved report.
      savedMissing = review.missingImages.length ? review.missingImages : JSON.parse(current.issues);
      savedNeedsReview = review.needsHumanReview || current.needsHumanReview !== 0 || savedMissing.length > 0;
      savedConfidence = extractionConfidence(Math.min(current.confidence, review.confidence), { needsHumanReview: savedNeedsReview, missingImages: savedMissing.length > 0 });
      transaction.prepare("UPDATE questions SET missing_images_json=?,confidence=?,needs_human_review=?,status=CASE WHEN ? THEN 'needs_attention' ELSE status END,updated_at=? WHERE id=?")
        .run(JSON.stringify(savedMissing), savedConfidence, savedNeedsReview ? 1 : 0, savedNeedsReview ? 1 : 0, new Date().toISOString(), questionId);
      if (!savedNeedsReview) return;
      transaction.prepare("UPDATE documents SET status='reviewing',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), question.documentId);
    });
    if (stale) {
      trace?.validation("failed", { error: "复核期间图片或原卷已修改，未应用结果" });
      return Response.json({ error: "复核期间图片或原卷已修改，请重新复核" }, { status: 409 });
    }
    const response = { ...review, confidence: savedConfidence, missingImages: savedMissing, needsHumanReview: savedNeedsReview, traceId: trace?.id };
    trace?.validation("complete", { questionId, ...response });
    return Response.json(response);
  } catch (error) {
    trace?.validation("failed", { questionId, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: error instanceof Error ? error.message : "图片复核失败" }, { status: 502 });
  }
}
