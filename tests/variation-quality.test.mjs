import test from "node:test";
import assert from "node:assert/strict";
import { parseVariationPlan, parseVariationVerification } from "../lib/variation-plan.ts";
import { parseVariationModelContent } from "../lib/question-variations.ts";

test("命题计划必须覆盖所有候选，最终复核对缺失、重复、否定和伪布尔值关闭通过", () => {
  const plan = { objective: "一次方程", prerequisites: "等式", difficultyRationale: "一步求解", misconception: "移项符号", changes: ["逆向", "情境"] };
  assert.deepEqual(parseVariationPlan(JSON.stringify(plan), 1), plan);
  assert.throws(() => parseVariationPlan(JSON.stringify({ ...plan, changes: [] }), 1));
  const check = { index: 1, solvable: true, answerCorrect: true, objectiveAligned: true, difficultyAligned: true, explanation: "代入满足等式" };
  assert.equal(parseVariationVerification(JSON.stringify({ checks: [check] }), 1).length, 1);
  for (const checks of [[], [check, check], [{ ...check, solvable: false }], [{ ...check, answerCorrect: "true" }], [{ ...check, explanation: "" }]]) assert.throws(() => parseVariationVerification(JSON.stringify({ checks }), 1));
});

test("选择题必须连续编号且答案引用真实选项", () => {
  const question = { type: "single", stem: "2+2=?", options: [{ key: "A", content: "3" }, { key: "B", content: "4" }], answer: "B", analysis: "2+2=4", tags: [] };
  const parse = q => parseVariationModelContent({ content: JSON.stringify({ variations: [q] }), count: 1, sourceType: q.type, sourceStem: "1+1=?", allowedTags: [], fallbackTags: [] });
  assert.equal(parse(question).length, 1);
  for (const answer of ["C", "AB", "答案为B"]) assert.throws(() => parse({ ...question, answer }));
  assert.throws(() => parse({ ...question, options: [{ key: "B", content: "3" }, { key: "C", content: "4" }] }));
  assert.throws(() => parse({ ...question, type: "multiple", answer: "B" }));
});
