import assert from "node:assert/strict";
import test from "node:test";
import { wholeDocumentSystemPrompt } from "../lib/document-extraction.ts";
import { ASSET_REVIEW_SYSTEM_PROMPT, parseCandidateSelection } from "../lib/asset-review.ts";
import { JSON_LATEX_PROMPT } from "../lib/extraction-prompt-rules.ts";
import { normalizeIsolatedQuestion } from "../lib/question-extraction.ts";
import { ExtractionStreamParser } from "../lib/streaming-extraction.ts";

const candidates = Array.from({ length: 10 }, (_, index) => ({ id: `candidate-${index}`, page: 1,
  pageWidth: 100, pageHeight: 100, x: 10, y: 10, width: 20, height: 20 }));
const base = { number: "1", stem: "题干", answer: "（1）结论", analysis: "证明过程。（1）结论",
  answerSource: "analysis", uncertainties: [], assets: [], uniqueImageCount: 0, selectedImageCount: 0,
  missingImages: [], unlocatedImages: false, confidence: 0.9, needsHumanReview: false };
const parse = value => parseCandidateSelection(JSON.stringify({ ...base, ...value }), candidates);
const normalize = value => normalizeIsolatedQuestion({ ...base, ...value }, { candidates, pageCount: 1, allowedTags: [] });

test("独立图数与副本次数分开，5个独立图可保留10个出现位置", () => {
  const assets = candidates.map(c => ({ id: c.id, role: "question", kind: "graph" }));
  const result = parse({ uniqueImageCount: 5, selectedImageCount: 10, assets });
  assert.equal(result.assets.length, 10);
  assert.equal(result.uniqueImageCount, 5);
  assert.equal(result.selectedImageCount, 10);
  assert.equal(result.needsHumanReview, false);
  assert.deepEqual(result.missingImages, []);
  const bad = parse({ uniqueImageCount: 5, selectedImageCount: 9, assets });
  assert.equal(bad.assets.length, 10);
  assert.equal(bad.needsHumanReview, true);
  assert.equal(bad.confidence, 0.65);
  assert.equal(bad.missingImages.length, 0); // A count error is not a missing picture.
});

test("去重仍须覆盖独立图，全部删除会产生缺图，旧计数协议兼容", () => {
  const missing = parse({ uniqueImageCount: 1 });
  assert.equal(missing.missingImages.length, 1);
  assert.equal(missing.confidence, 0.5);
  assert.equal(parse({ uniqueImageCount: 1, selectedImageCount: 1,
    assets: [{ id: candidates[0].id, role: "question", kind: "graph" }] }).needsHumanReview, false);
  assert.throws(() => parse({ uniqueImageCount: -1 }));
  assert.throws(() => parse({ selectedImageCount: undefined }));
  assert.equal(parse({ uniqueImageCount: undefined, selectedImageCount: undefined, expectedImageCount: 0 }).needsHumanReview, false);
});

test("缺失类别、字段位置和页码保留，模型声称无需复核也要降分", () => {
  for (const kind of ["unreadable", "absent", "incomplete", "uncertain"]) {
    const question = normalize({ uncertainties: [{ field: "analysis", page: 1, kind, reason: "第二小问末行待核对" }] });
    const issue = question.extractionIssues[0];
    assert.equal(issue.kind, kind); assert.equal(issue.field, "analysis"); assert.equal(issue.page, 1);
    assert.equal(question.needsHumanReview, true); assert.equal(question.confidence, 0.65);
    assert.equal(JSON.parse(JSON.stringify(question.extractionIssues))[0].kind, kind);
  }
  assert.ok(normalize({ uncertainties: [{ field: "answer", page: 2, kind: "absent", reason: "无答案" }] })
    .extractionIssues.some(i => i.code === "uncertainty_format"));
  assert.ok(normalize({ uncertainties: undefined }).extractionIssues.some(i => i.code === "uncertainty_format"));
});

test("解析结论来源合法；空答案来源或缺失原因矛盾时不能静默通过", () => {
  assert.equal(normalize({}).needsHumanReview, false);
  assert.ok(normalize({ answerSource: "none" }).extractionIssues.some(i => i.code === "answer_source"));
  assert.ok(normalize({ answer: "", answerSource: "none" }).extractionIssues.some(i => i.code === "unexplained_empty_field"));
  const question = normalize({ answer: "", answerSource: "none", uncertainties: [
    { field: "answer", page: null, kind: "absent", reason: "原卷未提供明确结论" },
  ] });
  assert.deepEqual(question.extractionIssues.map(i => i.code), ["transcription_absent"]);
});

test("解析成功的JSON也要检查数学控制字符；正常换行和正确LaTeX不误报", () => {
  for (const escaped of [String.raw`$\frac{1}{2}$`, String.raw`$\beta$`, String.raw`$\theta$`, String.raw`$\rho$`, String.raw`$\nabla$`]) {
    const stem = JSON.parse(`"${escaped}"`);
    assert.ok(normalize({ stem }).extractionIssues.some(i => i.code === "text_escape"), escaped);
  }
  assert.equal(normalize({ stem: String.raw`$\frac{1}{2}+\theta+\rho+\nabla$` + "\n下一行" }).needsHumanReview, false);
});

test("两条生产提示共用矩阵/数据表边界和去重规则，JSON外层示例可解析且无默认评分", () => {
  for (const prompt of [wholeDocumentSystemPrompt, ASSET_REVIEW_SYSTEM_PROMPT]) {
    assert.match(prompt, /数学矩阵、行列式、方程组、不等式组、分段函数/);
    assert.match(prompt, /绝不能把所有副本都删掉/);
    assert.match(prompt, /新增辅助线、坐标标注/);
    assert.match(prompt, /role 表示教学用途/);
    assert.match(prompt, /selectedImageCount/);
    assert.doesNotMatch(prompt, /"(?:confidence|questionCount|uniqueImageCount|selectedImageCount)"\s*:\s*\d/);
  }
  const sample = JSON_LATEX_PROMPT.split("\n").find(line => line.startsWith('{"event"'));
  const event = JSON.parse(sample);
  assert.equal(event.question.stem, String.raw`$\frac{a}{b}$`);
  const parser = new ExtractionStreamParser();
  assert.deepEqual(parser.push(sample), [event]);
  assert.deepEqual(parser.finish(), []);
});
