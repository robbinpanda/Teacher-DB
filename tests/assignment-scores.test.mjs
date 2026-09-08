import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssignmentScores, parseScoreEntries } from "../lib/assignment-scores.ts";

const items = [{ questionId: "q1", maxScore: 10 }, { questionId: "q2", maxScore: 5 }];

test("录分接口拒绝隐式转换、缺失、越界和非有限分数", () => {
  for (const value of [null, "", " ", false, true, [], {}, "3", undefined, NaN, Infinity, -1, 11]) {
    assert.throws(() => normalizeAssignmentScores(items, { q1: value, q2: 2 }), /第 1 题/);
  }
  assert.throws(() => normalizeAssignmentScores(items, { q1: 1 }), /第 2 题/);
  assert.throws(() => normalizeAssignmentScores(items, Object.create({ q1: 1, q2: 2 })), /第 1 题/);
});

test("录分保留明确填写的零分并支持合法小数", () => {
  assert.deepEqual(normalizeAssignmentScores(items, { q1: 0, q2: 4.5 }).map(item => item.score), [0, 4.5]);
  assert.deepEqual(parseScoreEntries(items, { q1: "0", q2: "4.5" }), { q1: 0, q2: 4.5 });
});

test("录分表单清空输入或未填写时不能完成批改", () => {
  for (const value of ["", "   ", undefined]) {
    assert.throws(() => parseScoreEntries(items, { q1: value, q2: "1" }), /零分请明确填写 0/);
  }
  assert.throws(() => parseScoreEntries(items, { q1: "1", q2: "6" }), /第 2 题/);
  assert.throws(() => parseScoreEntries(items, { q1: "NaN", q2: "1" }), /第 1 题/);
});
