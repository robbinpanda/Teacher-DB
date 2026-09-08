import assert from "node:assert/strict";
import test from "node:test";
import { validateQuestionPayload } from "../lib/question-payload.ts";

const valid = {
  number: "1",
  type: "fill",
  stem: "题干",
  options: [],
  answer: "答案",
  analysis: "解析",
  page: 1,
  bbox: { x: 0, y: 0, width: 50, height: 20 },
  regions: [],
  assets: [],
  tags: ["数列"],
  confidence: 0.9,
  needsHumanReview: false,
  status: "pending",
};

test("题目编辑数据通过完整运行时校验", () => {
  assert.equal(validateQuestionPayload(valid), null);
  assert.match(validateQuestionPayload({ ...valid, tags: 1 }), /标签/);
  assert.match(validateQuestionPayload({ ...valid, bbox: null }), /范围/);
  assert.match(validateQuestionPayload({ ...valid, assets: [{ id: "x" }] }), /题图/);
});

test("题目编辑数据限制数组数量和文本长度", () => {
  assert.match(validateQuestionPayload({ ...valid, regions: Array(13).fill(valid.regions) }), /跨页/);
  assert.match(validateQuestionPayload({ ...valid, stem: "x".repeat(50_001) }), /题干/);
});
