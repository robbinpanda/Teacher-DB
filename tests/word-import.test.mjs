import assert from "node:assert/strict";
import test from "node:test";
import { checkWordFormulas, restoreWordFormulas, wordModelText, wordParseSchema, wordToHtml } from "../lib/word-text.ts";
import { describeWordSummary } from "../lib/word-mime.ts";

function parse(overrides = {}) {
  return wordParseSchema.parse({
    version: 1,
    blocks: [
      { type: "paragraph", text: "1． 已知集合⟦F1⟧，则⟦F2⟧⟦F3⟧ ⟦I1⟧" },
      { type: "table", rows: [["A．⟦F4⟧", "B．⟦F5⟧"]] },
    ],
    formulas: [
      { id: "F1", source: "mathtype", latex: "A=\\{1,2\\}", display: false, status: "converted", problems: [], preview: null },
      { id: "F2", source: "omml", latex: "\\bar{A}=", display: false, status: "converted", problems: [], preview: null },
      { id: "F3", source: "blank", latex: "\\underline{\\hspace{4em}}", display: false, status: "converted", problems: [], preview: null },
      { id: "F4", source: "mathtype", latex: "x", display: false, status: "review", problems: ["private character U+E123"], preview: "I2" },
      { id: "F5", source: "omml", latex: "\\frac{1}{2}", display: false, status: "converted", problems: [], preview: null },
    ],
    assets: [
      { id: "I1", role: "image", mime: "image/png", width: 400, height: 300, displayWidth: 150, displayHeight: 112.5, key: "k1" },
      { id: "I2", role: "formula_preview", mime: "image/png", width: 40, height: 20, displayWidth: 20, displayHeight: 10, key: "k2" },
    ],
    report: { paragraphs: 1, tables: 1, images: 1, imagesUnreadable: 0, objectPreviews: 0, numberedParagraphs: 1, textBoxes: 0,
      reviewFormulas: 1, formulas: { mathtype: { converted: 1, review: 1 }, omml: { converted: 2, review: 0 } }, unsupported: {}, warnings: [] },
    ...overrides,
  });
}

test("Word 公式占位换回精确 LaTeX，相邻公式不拼成 $$，填空统一为题库空格", () => {
  const question = { stem: "已知集合⟦F1⟧，则⟦F2⟧⟦F3⟧", answer: "⟦ F5 ⟧", analysis: "见⟦图⟧", options: [{ key: "A", content: "⟦F4⟧" }] };
  const { issues, used } = restoreWordFormulas(question, parse());
  assert.equal(question.stem, "已知集合$A=\\{1,2\\}$，则$\\bar{A}=$ $\\underline{\\hspace{2em}}$");
  assert.equal(question.answer, "$\\frac{1}{2}$");
  assert.equal(question.analysis, "见");
  assert.equal(question.options[0].content, "");
  assert.deepEqual(used, ["F1", "F2", "F3", "F5"]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /F4/);
});

test("模型输出未能读取的公式标记时，题目被标记待核对", () => {
  const question = { stem: "求⟦公式见页面⟧的值", answer: "", analysis: "", options: [] };
  const { issues } = restoreWordFormulas(question, parse());
  assert.equal(question.stem, "求的值");
  assert.deepEqual(issues.map(issue => issue.code), ["word_formula_review"]);
});

test("给模型的原文只锁定可靠公式，未能转换的公式让模型看页面", () => {
  const text = wordModelText(parse());
  assert.match(text, /1． 已知集合⟦F1⟧，则⟦F2⟧⟦F3⟧ ⟦图⟧/);
  assert.match(text, /A．⟦公式见页面⟧ \| B．⟦F5⟧/);
  assert.match(text, /F1 = A=\\\{1,2\\\}/);
  assert.doesNotMatch(text, /F4 =/);
  assert.equal(wordModelText(parse(), 100), null);
});

test("排版页面：公式用 KaTeX，失败公式用原预览图，图片按 Word 版面尺寸", () => {
  const html = wordToHtml(parse());
  assert.match(html, /class="katex"/);
  assert.match(html, /<img class="formula" src="assets\/I2" style="width:20\.0pt">/);
  assert.match(html, /<img class="figure" src="assets\/I1" style="width:150pt">/);
  assert.match(html, /<table><tr><td>A．/);
  assert.doesNotMatch(html, /⟦/);
});

test("KaTeX 无法排版的公式改为待核对并计入报告", () => {
  const value = parse();
  value.formulas[0].latex = "\\frac{1}{";
  assert.equal(checkWordFormulas(value), 1);
  assert.equal(value.formulas[0].status, "review");
  assert.equal(value.report.reviewFormulas, 2);
});

test("Word 导入摘要说明公式来源与待核对数量", () => {
  const text = describeWordSummary({ formulas: 444, mathtype: 296, omml: 148, reviewFormulas: 0, images: 6, imagesUnreadable: 0, textBoxes: 0, warnings: [] });
  assert.equal(text, "从 Word 直接读取公式 444 个（MathType 296、Word 公式 148）；全部按结构精确转换；图片 6 张。");
  assert.match(describeWordSummary({ formulas: 3, mathtype: 3, omml: 0, reviewFormulas: 2, images: 0, imagesUnreadable: 1, textBoxes: 1, warnings: [] }), /2 个未能可靠转换.*1 张图片无法读取.*1 个文本框/);
});

test("公式图片标为 ⟦式⟧ 让模型按页面抄录；按页面坐标排布的卷不发原文", () => {
  const value = parse();
  value.assets[0].role = "formula_image";
  const text = wordModelText(value);
  assert.match(text, /⟦F3⟧ ⟦式⟧/);
  assert.doesNotMatch(text, /F3⟧ ⟦图⟧/);
  const html = wordToHtml(value);
  assert.match(html, /<img class="formula" src="assets\/I1" style="width:150\.0pt">/);
  const question = { stem: "已知⟦式⟧，求值", answer: "", analysis: "", options: [] };
  assert.deepEqual(restoreWordFormulas(question, value).issues.map(issue => issue.code), ["word_formula_review"]);
  assert.equal(question.stem, "已知，求值");
  const positioned = parse();
  positioned.report.layout = "positioned";
  assert.equal(wordModelText(positioned), null);
});

test("摘要说明 .doc 转换、公式图片和固定版式", () => {
  const base = { formulas: 0, mathtype: 0, omml: 0, reviewFormulas: 0, images: 17, imagesUnreadable: 0, textBoxes: 0, warnings: [] };
  assert.equal(describeWordSummary({ ...base, formulaImages: 177, convertedFromDoc: true, layout: "flow" }),
    "旧版 .doc 已自动转换；177 处公式是图片，已按页面识别，需重点核对；图片 17 张。");
  assert.equal(describeWordSummary({ ...base, images: 156, layout: "positioned" }),
    "该卷的公式和图片按页面坐标排布（多由 PDF 转成 Word），已按原版式识别，公式需逐题核对。");
  // Two small pictures beside hundreds of MathType formulas are logos, not worth a warning.
  assert.doesNotMatch(describeWordSummary({ ...base, formulas: 600, mathtype: 600, images: 9, formulaImages: 2 }), /公式是图片/);
});
