import test from "node:test";
import assert from "node:assert/strict";
import { contextualPresetTags, presetTags, stageFromGrade, textbookEditions } from "../lib/education-taxonomy.ts";
import { normalizePaperStyle, paperStyleToLatex, presetPaperTemplates, questionStemHasAnswerBlank, scoreForQuestion, sectionsFromTemplate } from "../lib/paper-templates.ts";

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

test("地区与教材画像会扩充标签，但不破坏基础知识点目录", () => {
  const tags = contextualPresetTags("数学", "middle", "上海", "沪教版");
  assert.ok(tags.includes("二次函数"));
  assert.ok(tags.includes("地区·上海"));
  assert.ok(tags.includes("教材·沪教版"));
  assert.equal(new Set(tags).size, tags.length);
});

test("教材版本按学段避免把高中人教 A/B 版用于义务教育", () => {
  assert.ok(textbookEditions("数学", "high").includes("人教A版"));
  assert.equal(textbookEditions("数学", "middle").includes("人教A版"), false);
  assert.ok(textbookEditions("英语", "primary").includes("人教PEP版"));
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
  assert.equal(template.config.style.sectionDivider, "none");
  assert.equal(template.config.style.headerDivider, "none");
  assert.equal(template.config.style.noticeStyle, "plain");
  assert.equal(template.config.style.showBindingLine, false);
  assert.equal(template.config.style.scoreStyle, "hidden");
});

test("排版模板参数会被规范化并生成 LaTeX 页面语义", () => {
  const style = normalizePaperStyle({ pageSize: "A3", orientation: "landscape", marginTop: 999, bodySize: 4, lineHeight: 2.2, columns: 2, titleSize: 28, titleLineHeight: 1.4, titleMarginBottom: 7, titleItalic: true, questionNumberStyle: "chinese" });
  assert.equal(style.pageSize, "A3");
  assert.equal(style.orientation, "landscape");
  assert.equal(style.marginTop, 45);
  assert.equal(style.bodySize, 7);
  assert.equal(style.columns, 2);
  assert.equal(style.titleItalic, true);
  assert.equal(style.questionNumberStyle, "chinese");
  const latex = paperStyleToLatex(style);
  assert.match(latex, /a3paper,landscape/);
  assert.match(latex, /top=45mm/);
  assert.match(latex, /fontsize\{28pt\}\{39\.20pt\}/);
  assert.match(latex, /papertitlegap\}\{7mm\}/);
  assert.match(latex, /\\twocolumn/);
});

test("填空题只在题干没有答案横线时补充行内答题位", () => {
  assert.equal(questionStemHasAnswerBlank("若 x=1，则 y=____。"), true);
  assert.equal(questionStemHasAnswerBlank("若 x=1，则 y=\\underline{}。"), true);
  assert.equal(questionStemHasAnswerBlank("若 x=1，则 y 的值为"), false);
  assert.equal(normalizePaperStyle({}).sectionDivider, "none");
});
