import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWholeDocumentExtraction,
  parseExtractionJson,
  wholeDocumentSystemPrompt,
} from "../lib/document-extraction.ts";

test("整卷识别不生成题目范围，并区分题图与答案图", () => {
  const result = normalizeWholeDocumentExtraction({
    documentMeta: { year: 2026 },
    questions: [{
      number: "1",
      type: "answer",
      stem: "证明 $a=b$",
      answer: "$a=b$",
      analysis: "由题意可得",
      sourcePages: [1, 2],
      regions: [{ page: 1, bbox: { x: 1, y: 1, width: 90, height: 90 } }],
      assets: [
        { role: "question", kind: "figure", label: "题图", page: 1, bbox: { x: 10, y: 20, width: 30, height: 20 } },
        { role: "answer", kind: "graph", label: "解析图", page: 4, bbox: { x: 15, y: 25, width: 40, height: 30 } },
      ],
      tags: ["几何", "非法标签"],
      confidence: 0.9,
      needsHumanReview: false,
    }],
  }, { pageCount: 4, allowedTags: ["几何"] });

  assert.equal(result.questions.length, 1);
  assert.deepEqual(result.questions[0].regions, []);
  assert.equal(result.questions[0].page, 1);
  assert.deepEqual(result.questions[0].tags, ["几何"]);
  assert.deepEqual(result.questions[0].assets.map((asset) => asset.role), ["question", "answer"]);
});

test("整卷识别拒绝缺失题号，避免部分结果被当成完整试卷", () => {
  assert.throws(() => normalizeWholeDocumentExtraction({
    questions: [
      { number: "1", stem: "第一题", sourcePages: [1], needsHumanReview: false },
      { number: "3", stem: "第三题", sourcePages: [2], needsHumanReview: false },
    ],
  }, { pageCount: 2, allowedTags: [] }), /缺少第 2 题/);
});

test("整卷提示明确禁止 AI 返回整题范围", () => {
  assert.match(wholeDocumentSystemPrompt, /不要输出题目整体范围/);
  assert.match(wholeDocumentSystemPrompt, /role/);
  assert.deepEqual(parseExtractionJson("```json\n{\"questions\":[]}\n```"), { questions: [] });
});
