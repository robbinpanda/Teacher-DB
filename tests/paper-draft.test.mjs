import test from "node:test";
import assert from "node:assert/strict";
import { resolveInitialPaperQuestions } from "../lib/paper-draft.ts";

const questions = [
  { id: "q1", stem: "第一题" },
  { id: "q2", stem: "第二题" },
  { id: "q3", stem: "第三题" },
];

test("新建组卷未传题目时保持空白，不自动生成样卷", () => {
  assert.deepEqual(resolveInitialPaperQuestions(questions, []), []);
});

test("新建组卷仅采用题库明确选中的题目并保持顺序", () => {
  assert.deepEqual(resolveInitialPaperQuestions(questions, ["q3", "q1", "q3", "missing"]), [questions[2], questions[0]]);
});
