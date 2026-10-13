import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIsolatedQuestion, unresolvedQuestion } from "../lib/question-extraction.ts";

const candidates = Array.from({ length: 10 }, (_, i) => ({ id: `p1-${i}`, page: 1, pageWidth: 100, pageHeight: 100, x: 10, y: 10, width: 20, height: 20 }));
const raw = { number: "14", stem: "题干", answer: "答案", analysis: "解析", assets: [], expectedImageCount: 0, missingImages: [], unlocatedImages: false, confidence: 0.99, needsHumanReview: false };
const normalize = value => normalizeIsolatedQuestion({ ...raw, ...value }, { candidates, pageCount: 1, allowedTags: [] });

test("数量填9但选图10：保留全部10张及文本，仅本题待审核", () => {
  const question = normalize({ expectedImageCount: 9, assets: candidates.map(c => ({ id: c.id, kind: "graph", role: "question" })) });
  assert.equal(question.assets.length, 10); assert.equal(question.stem, "题干");
  assert.equal(question.status, "needs_attention"); assert.match(question.missingImages[0].description, /9.*10/);
  assert.equal(normalize({ number: "15" }).status, "pending");
});
test("图片字段损坏时保留有效候选与文本，未知框记缺图，不信任自报坐标", () => {
  const question = normalize({ unlocatedImages: {}, assets: [{ id: "p1-0", kind: "graph", role: "answer", bbox: {} }, { id: "missing", kind: "figure", role: "question" }, { id: "p1-1", kind: "bad", role: "bad" }] });
  assert.equal(question.assets.length, 1); assert.equal(question.assets[0].bbox.x, 10);
  assert.equal(question.answer, "答案"); assert.equal(question.extractionIssues[0].code, "invalid_assets");
  assert.ok(question.extractionIssues[0].raw); assert.ok(question.missingImages.length);
});
test("公式缺括号、JSON错误转义均标记本题，保留文本用于修正", () => {
  for (const stem of ["$\\frac1}{2}$", "$\\frac{1}{2$", "\bfrac{1}{2}"]) {
    const question = normalize({ stem }); assert.equal(question.stem, stem); assert.equal(question.status, "needs_attention");
    assert.ok(question.extractionIssues.length);
  }
  assert.equal(normalize({ stem: "$\\frac{1}{2} \\left\\{x\\right\\}$" }).status, "pending");
});
test("不可解析的题目保留原文和题号，空白占位不伪造题干", () => {
  const question = unresolvedQuestion("2", 3, "JSON错误", "原始残缺输出");
  assert.equal(question.number, "2"); assert.equal(question.page, 3); assert.equal(question.stem, "");
  assert.equal(question.status, "needs_attention"); assert.equal(question.extractionIssues[0].raw, "原始残缺输出");
});
