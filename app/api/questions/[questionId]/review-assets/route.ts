import { snapshotTeachingSkill } from "../../../../../lib/teaching-skills";
import { getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { getFile } from "../../../../../lib/file-storage";
import { requestOwner } from "../../../../../lib/server";
import { callVisionModelStream } from "../../../../../lib/vision-model";
import { detectAssetCandidates, annotateAssetCandidates } from "../../../../../lib/asset-candidates";
import { ASSET_REVIEW_SYSTEM_PROMPT, parseCandidateSelection, type PageAssetCandidate } from "../../../../../lib/asset-review";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  await ensureDatabase();
  const { questionId } = await context.params;
  const ownerId = requestOwner(request);
  const sqlite = getSqlite();
  const question = sqlite.prepare(`SELECT q.document_id AS documentId, q.number, q.stem, q.answer, q.analysis,
    d.subject, d.grade, d.source_removed_at AS removed FROM questions q JOIN documents d ON d.id=q.document_id
    WHERE q.id=? AND d.owner_id=?`).get(questionId, ownerId) as {
      subject: string | null; grade: string | null; documentId: string; number: string; stem: string; answer: string; analysis: string; removed: string | null;
    } | undefined;
  if (!question) return Response.json({ error: "题目不存在" }, { status: 404 });
  if (question.removed) return Response.json({ error: "原试卷已删除，无法复核图片" }, { status: 409 });
  const sourcePages = sqlite.prepare("SELECT page_number AS page, storage_key AS storageKey FROM pages WHERE document_id=? ORDER BY page_number")
    .all(question.documentId) as Array<{ page: number; storageKey: string }>;
  if (!sourcePages.length || sourcePages.length > 60) return Response.json({ error: "图片复核支持 1–60 页原卷" }, { status: 422 });
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
      candidates.push(...pageCandidates.map((c) => ({ ...c, page: page.page, pageWidth: found.width, pageHeight: found.height })));
      const annotated = await annotateAssetCandidates(bytes, pageCandidates);
      images.push({ page: page.page, dataUrl: `data:image/jpeg;base64,${annotated.toString("base64")}` });
    }
    const teachingSkill = await snapshotTeachingSkill(ownerId, question.subject || "数学", question.grade || "", question.documentId, `assets:${questionId}:${crypto.randomUUID()}`);
    const result = await callVisionModelStream({
      ownerId, documentId: question.documentId, purpose: "question_reextract", pageCount: images.length, images,
      system: `${teachingSkill.content}\n${ASSET_REVIEW_SYSTEM_PROMPT}`,
      text: JSON.stringify({ questionNumber: question.number, stem: question.stem, answer: question.answer, analysis: question.analysis,
        candidates: candidates.map((c) => ({ id: c.id, page: c.page })) }),
    }, { onTextDelta: () => {} });
    const review = parseCandidateSelection(result.content, candidates, sourcePages.map((p) => p.page));
    sqliteTransaction((transaction) => {
      // A later successful check must not silently dismiss an earlier unresolved report.
      if (!review.missingImages.length) return;
      transaction.prepare("UPDATE questions SET missing_images_json=?,needs_human_review=1,status='needs_attention',updated_at=? WHERE id=?")
        .run(JSON.stringify(review.missingImages), new Date().toISOString(), questionId);
      transaction.prepare("UPDATE documents SET status='reviewing',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), question.documentId);
    });
    const unresolved = sqlite.prepare("SELECT missing_images_json AS issues FROM questions WHERE id=?").get(questionId) as { issues: string };
    return Response.json({ ...review, missingImages: JSON.parse(unresolved.issues), needsHumanReview: review.needsHumanReview || unresolved.issues !== "[]" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "图片复核失败" }, { status: 502 });
  }
}
