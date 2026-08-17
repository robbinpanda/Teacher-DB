import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWholeDocumentExtraction,
  parseExtractionJson,
  wholeDocumentSystemPrompt,
} from "../lib/document-extraction.ts";
import { stripLeadingQuestionNumber } from "../lib/question-text.js";

test("整卷识别不生成题目范围，并区分题图与答案图", () => {
  const result = normalizeWholeDocumentExtraction({
    documentMeta: { year: 2026 },
    questions: [{
      number: "1",
      type: "answer",
      stem: "证明 $a=b$",
      answer: "$a=b$",
      analysis: "由题意可得",
      firstLinePage: 2,
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
  assert.equal(result.questions[0].page, 2);
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

test("整卷提示要求记录首行页并逐字转录答案", () => {
  assert.match(wholeDocumentSystemPrompt, /不要输出题目整体范围/);
  assert.match(wholeDocumentSystemPrompt, /firstLinePage/);
  assert.match(wholeDocumentSystemPrompt, /不得概括/);
  assert.match(wholeDocumentSystemPrompt, /role/);
  assert.match(wholeDocumentSystemPrompt, /questionCount/);
  assert.match(wholeDocumentSystemPrompt, /每完成一题就立刻输出/);
  assert.match(wholeDocumentSystemPrompt, /stem 必须从题号后的题干正文开始/);
  assert.match(wholeDocumentSystemPrompt, /题内的（1）（2）等小问编号必须完整保留/);
  assert.match(wholeDocumentSystemPrompt, /每个 asset 必须且只能包含 role、kind、label、page、bbox/);
  assert.match(wholeDocumentSystemPrompt, /即使 page 与 firstLinePage 相同/);
  assert.match(wholeDocumentSystemPrompt, /严禁把 bbox 输出成数组/);
  assert.match(wholeDocumentSystemPrompt, /\"page\":4,\"bbox\":\{\"x\":9,\"y\":39,\"width\":26,\"height\":16\}/);
  assert.match(wholeDocumentSystemPrompt, /频数\/频率分布表/);
  assert.match(wholeDocumentSystemPrompt, /茎叶图/);
  assert.match(wholeDocumentSystemPrompt, /任何依靠行列、单元格、表头、分隔线或空间位置表达含义的内容，都一律截图保存为 kind=table/);
  assert.match(wholeDocumentSystemPrompt, /无论表格多简单、是否能用 LaTeX 表达，都没有例外/);
  assert.match(wholeDocumentSystemPrompt, /表格只能出现一次/);
  assert.match(wholeDocumentSystemPrompt, /严禁在 stem、options、answer、analysis 中生成或保留任何 LaTeX 表格代码/);
  assert.match(wholeDocumentSystemPrompt, /\\multicolumn/);
  assert.deepEqual(parseExtractionJson("```json\n{\"questions\":[]}\n```"), { questions: [] });
});

test("题干去掉重复的顶层原题号但保留小问编号", () => {
  assert.equal(stripLeadingQuestionNumber("1. 已知集合 A", "1"), "已知集合 A");
  assert.equal(stripLeadingQuestionNumber("12、求函数的值", "12"), "求函数的值");
  assert.equal(stripLeadingQuestionNumber("（1）求函数的值", "12"), "（1）求函数的值");
  assert.equal(stripLeadingQuestionNumber("1.5 千克物体的质量", "1"), "1.5 千克物体的质量");
  assert.equal(stripLeadingQuestionNumber("1:2 的比例", "1"), "1:2 的比例");
});
