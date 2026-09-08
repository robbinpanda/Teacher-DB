import assert from "node:assert/strict";
import test from "node:test";
import { calculateAssignmentAnalytics } from "../lib/assignment-analytics.ts";
import { parseRosterCsv } from "../lib/roster-csv.ts";

test("班级名单支持中文表头、BOM、引号和座号", () => {
  const rows = parseRosterCsv('\uFEFF学号,姓名,座号\r\n2026001,"张,同学",01\r\n2026002,李同学,02\r\n');
  assert.deepEqual(rows, [
    { studentNo: "2026001", name: "张,同学", seatNumber: "01" },
    { studentNo: "2026002", name: "李同学", seatNumber: "02" },
  ]);
});

test("班级名单拒绝缺失表头、重复学号和未闭合引号", () => {
  assert.throws(() => parseRosterCsv("编号,班级\n1,一班"), /学号.*姓名/);
  assert.throws(() => parseRosterCsv("学号,姓名\n1,甲\n1,乙"), /重复/);
  assert.throws(() => parseRosterCsv('学号,姓名\n1,"甲'), /未闭合/);
});

test("学情只统计已批改学生，并按分值加权知识点", () => {
  const result = calculateAssignmentAnalytics([
    { questionId: "q1", position: 0, maxScore: 2, tags: ["函数"] },
    { questionId: "q2", position: 1, maxScore: 8, tags: ["函数", "数形结合"] },
  ], [
    { studentId: "s1", studentName: "甲", status: "graded", scores: { q1: 2, q2: 4 } },
    { studentId: "s2", studentName: "乙", status: "assigned", scores: { q1: 2, q2: 8 } },
  ]);
  assert.equal(result.gradedCount, 1);
  assert.equal(result.classAverageRate, 0.6);
  assert.equal(result.questions[0].rate, 1);
  assert.equal(result.questions[1].rate, 0.5);
  assert.equal(result.tags.find((item) => item.tag === "函数")?.rate, 0.6);
  assert.deepEqual(result.weakQuestionIds, ["q2"]);
});
