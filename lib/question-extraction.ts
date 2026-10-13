import { normalizeStreamedQuestion } from "./document-extraction.ts";
import { parseCandidateSelection, type PageAssetCandidate } from "./asset-review.ts";
import { mapCandidateImageMarkers } from "./analysis-images.ts";
import type { ExtractionIssue, Question } from "./types";

export function normalizeIsolatedQuestion(raw: Record<string, unknown>, input: {
  candidates: PageAssetCandidate[]; pageCount: number; allowedTags: string[]; issues?: ExtractionIssue[];
}): Question {
  const issues = [...(input.issues ?? [])];
  const pages = Array.from({ length: input.pageCount }, (_, index) => index + 1);
  let selection: ReturnType<typeof parseCandidateSelection>;
  try { selection = parseCandidateSelection(JSON.stringify(raw), input.candidates, pages); }
  catch (error) {
    issues.push({ code: "invalid_assets", message: error instanceof Error ? error.message : "图片信息无效", raw: JSON.stringify(raw) });
    // Recover independently valid selections without trusting model coordinates.
    const assets: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(raw.assets) ? raw.assets : []) {
      if (!item || seen.has(item.id) || !["question", "answer"].includes(item.role) || !["figure", "graph", "table"].includes(item.kind)) continue;
      assets.push(item); seen.add(item.id);
    }
    selection = parseCandidateSelection(JSON.stringify({ assets: assets.slice(0, 30), expectedImageCount: Math.min(assets.length, 30),
      missingImages: [], unlocatedImages: true, needsHumanReview: true, confidence: raw.confidence }), input.candidates, pages);
  }
  for (const message of selection.formatWarnings) issues.push({ code: "asset_format", message, raw: JSON.stringify(raw) });
  if (typeof raw.stem !== "string" || !raw.stem.trim()) issues.push({ code: "missing_stem", message: "题干缺失，请对照原卷补录" });
  const texts = [raw.stem, raw.answer, raw.analysis, ...(Array.isArray(raw.options) ? raw.options.map(item => item?.content) : [])];
  if (texts.some(value => typeof value === "string" && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) {
    issues.push({ code: "text_escape", message: "题目文本包含异常控制字符，可能由 LaTeX 转义错误造成，请对照原卷修正", raw: JSON.stringify(raw) });
  }
  if (texts.some(value => {
    if (typeof value !== "string") return false;
    let depth = 0;
    for (const character of value.replace(/\\[{}]/g, "")) {
      if (character === "{") depth++;
      if (character === "}" && --depth < 0) return true;
    }
    return depth !== 0;
  })) issues.push({ code: "unbalanced_formula", message: "题目文本的花括号不成对，请检查公式是否缺少 { 或 }", raw: JSON.stringify(raw) });
  const question = normalizeStreamedQuestion({ ...raw,
    analysis: mapCandidateImageMarkers(String(raw.analysis ?? ""), selection.answerCandidateIds),
    assets: selection.assets, missingImages: selection.missingImages,
    confidence: selection.confidence, needsHumanReview: selection.needsHumanReview || issues.length > 0,
  }, input);
  question.missingImages = selection.missingImages;
  question.extractionIssues = issues;
  return question;
}

export function unresolvedQuestion(number: string, page: number, message: string, raw?: string): Question {
  const question = normalizeStreamedQuestion({ number, firstLinePage: page, needsHumanReview: true, confidence: 0 }, { pageCount: page, allowedTags: [] });
  question.extractionIssues = [{ code: "unreadable_question", message, raw }];
  return question;
}
