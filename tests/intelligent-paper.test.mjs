import test from "node:test";
import assert from "node:assert/strict";
import { presetTags, stageFromGrade } from "../lib/education-taxonomy.ts";
import { presetPaperTemplates, scoreForQuestion, sectionsFromTemplate } from "../lib/paper-templates.ts";

const source = { documentId: "d", documentName: "卷", subject: "数学", grade: "九年级" };
const base = { answer: "", analysis: "", page: 1, bbox: { x: 0, y: 0, width: 1, height: 1 }, regions: [], assets: [], tags: [], confidence: 1, status: "approved", source };

test("年级映射到小学、初中和高中范围", () => {
  assert.equal(stageFromGrade("六年级"), "primary");
  assert.equal(stageFromGrade("九年级"), "middle");
  assert.equal(stageFromGrade("高三"), "high");
});

test("数学标签随学段变化且来自有限目录", () => {
  const middle = presetTags("数学", "middle");
  const high = presetTags("数学", "high");
  assert.ok(middle.includes("二次函数"));
  assert.ok(high.includes("导数"));
  assert.equal(middle.includes("导数"), false);
  assert.equal(new Set(middle).size, middle.length);
});

test("中考模板按题型分板块并应用标准分值", () => {
  const template = presetPaperTemplates.find((item) => item.id === "preset-middle-math-exam");
  const questions = [
    { ...base, id: "q1", number: "1", type: "single", stem: "选择" },
    { ...base, id: "q2", number: "7", type: "fill", stem: "填空" },
    { ...base, id: "q3", number: "19", type: "answer", stem: "解答" },
  ];
  const sections = sectionsFromTemplate(template, questions);
  assert.deepEqual(sections.map((section) => section.questionIds), [["q1"], ["q2"], ["q3"]]);
  assert.equal(scoreForQuestion(sections[0], 0), 4);
  assert.equal(scoreForQuestion(sections[2], 0), 10);
  assert.match(sections[2].scoreDetail, /满分 78 分/);
});
