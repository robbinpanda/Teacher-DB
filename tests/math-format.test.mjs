import test from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_LATEX,
  findMathFormatProblems,
  normalizeMathText,
  normalizeTextForDisplay,
  prepareLatex,
  repairDisplayText,
  repairTrailingDollar,
  scanMathText,
  splitMathBlanks,
  splitOutsideBlanks,
  wrapBareLatex,
} from "../lib/math-format.ts";

test("closes an inline formula whose row break ends in two backslashes", () => {
  const value = String.raw`已知 $f(x)=\begin{cases} 1 & x>0 \\ 0 & x\le 0 \end{cases}$，求值。`;
  const tokens = scanMathText(normalizeTextForDisplay(value));
  assert.equal(tokens.length, 3);
  assert.equal(tokens[1].type, "math");
  assert.match(tokens[1].value, /\\end\{cases\}$/);
  assert.equal(tokens[2].value, "，求值。");
});

test("does not treat an escaped currency dollar as a math delimiter", () => {
  const tokens = scanMathText(String.raw`价格 \$5，公式 $x=1$。`);
  assert.equal(tokens[0].type, "text");
  assert.match(tokens[0].value, /\\\$5/);
  assert.equal(tokens[1].type, "math");
  assert.equal(tokens[1].value, "x=1");
});

test("renders a trailing raw underline as the same blank as every other style", () => {
  const value = String.raw`则 $A\cap B=$\underline{\qquad}.`;
  const parts = splitOutsideBlanks(String.raw`\underline{\qquad}.`);
  assert.deepEqual(parts[0], { type: "blank" });
  assert.equal(normalizeMathText(value), String.raw`则 $A\cap B=$ $\underline{\hspace{2em}}$.`);
});

test("normalizes ASCII, full-width and LaTeX blanks to one canonical form", () => {
  const normalized = normalizeMathText("甲 ______ 乙 ＿＿＿＿ 丙 $\\underline{\\hspace{2em}}$");
  assert.equal(normalized.split(`$${BLANK_LATEX}$`).length - 1, 3);
  assert.doesNotMatch(normalized, /_{2,}|＿{2,}/);
});

test("wraps a bare formula saved without dollar signs", () => {
  assert.equal(normalizeMathText(String.raw`答案 \dfrac{2}{7}`), String.raw`答案 $\dfrac{2}{7}$`);
  assert.equal(wrapBareLatex(String.raw`g（\sqrt{2}）≤1`), String.raw`$g（\sqrt{2}）≤1$`);
  assert.equal(wrapBareLatex(String.raw`g（x）_{max}=max｛g（0），g（\sqrt{2}）｝`),
    String.raw`$g（x）_{max}=max｛g（0），g（\sqrt{2}）｝$`);
});

test("inline fractions get display style so they are not flattened", () => {
  assert.equal(prepareLatex(String.raw`\frac{a}{b}`, false), String.raw`\displaystyle \frac{a}{b}`);
  assert.equal(prepareLatex(String.raw`\dfrac{a}{b}`, false), String.raw`\displaystyle \dfrac{a}{b}`);
  assert.equal(prepareLatex(String.raw`a+b`, false), "a+b");
  assert.equal(prepareLatex(String.raw`\frac{a}{b}`, true), String.raw`\frac{a}{b}`);
});

test("canonical output has no residual formatting problems", () => {
  const values = [
    String.raw`则 $A\cap B=$\underline{\qquad}.`,
    "填空 ______ 和 ＿＿＿＿",
    String.raw`答案 \dfrac{2}{7}`,
    String.raw`函数 $y=\frac{x}{1+x}$ 的定义域为 $(-\infty,-1)\cup(-1,+\infty)$。`,
  ];
  for (const value of values) {
    assert.deepEqual(findMathFormatProblems(normalizeMathText(value)), [], value);
  }
});

test("blank splitting keeps punctuation around the underline", () => {
  assert.deepEqual(splitOutsideBlanks(String.raw`的值为\underline{\hspace{2em}}.`), [
    { type: "text", value: "的值为" },
    { type: "blank" },
    { type: "text", value: "." },
  ]);
  assert.deepEqual(splitMathBlanks(String.raw`x=${BLANK_LATEX}`), [
    { type: "text", value: "x=" },
    { type: "blank" },
  ]);
});

test("repairs only a missing closing dollar at the end of a formula", () => {
  assert.equal(repairTrailingDollar(String.raw`若$z_1,z_2\in C$且$z_1-z_2>0$，则$z_1>z_2`),
    String.raw`若$z_1,z_2\in C$且$z_1-z_2>0$，则$z_1>z_2$`);
  assert.equal(repairTrailingDollar(String.raw`则 $A\cap B=$\underline{\qquad}$.`), String.raw`则 $A\cap B=$\underline{\qquad}$.`);
  assert.equal(repairTrailingDollar(String.raw`价格 \$5 与 $x=1$`), String.raw`价格 \$5 与 $x=1$`);
});

test("literal line escapes never split LaTeX commands", () => {
  const value = String.raw`$\triangle ABC$ 中 $a\neq b$，$\theta\times 2$\n（2）求值\tA`;
  assert.equal(normalizeTextForDisplay(value), String.raw`$\triangle ABC$ 中 $a\neq b$，$\theta\times 2$` + "\n（2）求值\tA");
});

test("markdown-escaped underscores are one blank", () => {
  assert.deepEqual(splitOutsideBlanks(String.raw`投影为\_\_\_\_\_\_。`), [
    { type: "text", value: "投影为" },
    { type: "blank" },
    { type: "text", value: "。" },
  ]);
  assert.equal(normalizeMathText(String.raw`投影为\_\_\_\_。`), `投影为$${BLANK_LATEX}$。`);
  assert.ok(findMathFormatProblems(String.raw`投影为\_\_\_。`).some((problem) => problem.kind === "raw_blank"));
});

test("stray image markers are hidden from displayed text", () => {
  assert.equal(repairDisplayText("设∠ABD=α\n[[image:p14-2]]\n（1）"), "设∠ABD=α\n\n（1）");
});
