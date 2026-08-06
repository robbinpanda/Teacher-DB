import assert from "node:assert/strict";
import test from "node:test";
import { moveOrderedItem } from "../lib/ordered-selection.ts";

test("选题篮可上下调整题目并保持其他题目顺序", () => {
  assert.deepEqual(moveOrderedItem(["q1", "q2", "q3"], 1, -1), ["q2", "q1", "q3"]);
  assert.deepEqual(moveOrderedItem(["q1", "q2", "q3"], 1, 1), ["q1", "q3", "q2"]);
});

test("选题篮越界移动不会改变原列表", () => {
  const questions = ["q1", "q2"];
  assert.equal(moveOrderedItem(questions, 0, -1), questions);
  assert.equal(moveOrderedItem(questions, 1, 1), questions);
});
