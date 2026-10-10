import test from "node:test";
import assert from "node:assert/strict";
import { corroborateSourceQuestionInventory, validateExtractionQuestionNumbers } from "../lib/source-question-inventory.ts";

function fixture(count = 20) {
  return [
    { page: 1, text: "选择题（本大题共4题）" },
    ...Array.from({ length: count }, (_, index) => ({ page: 1, text: `${index + 1}．（5 分）第${index + 1}道题正文` })),
    { page: 1, text: "第1页（共21页）" },
    { page: 2, text: "参考答案与试题解析" },
    ...Array.from({ length: count }, (_, index) => ({ page: 2, text: `${index + 1}．（5 分）第${index + 1}道题答案` })),
    { page: 2, text: "第2页（共21页）" },
  ];
}

test("正文和答案均为1～20时以可核验题号计数，忽略21页及错误章节标注", () => {
  const inventory = corroborateSourceQuestionInventory(fixture(), 2);
  assert.equal(inventory.questionCount, 20);
  assert.equal(inventory.questions.at(-1).firstLinePage, 1);
  assert.equal(inventory.answers.at(-1).firstLinePage, 2);
  // A model's incorrect declaration must not create an imaginary final question.
  const modelDeclaredCount = 21;
  assert.doesNotThrow(() => validateExtractionQuestionNumbers(inventory?.questionCount ?? modelDeclaredCount,
    Array.from({ length: 20 }, (_, index) => String(index + 1))));
});

test("原卷真的有21题时，模型仅返回20题仍被拒绝；中间漏题、重复和虚构题号也不能通过", () => {
  const inventory = corroborateSourceQuestionInventory(fixture(21), 2);
  const numbers = Array.from({ length: 21 }, (_, index) => String(index + 1));
  assert.throws(() => validateExtractionQuestionNumbers(inventory.questionCount, numbers.slice(0, -1)), /缺少第 21 题/);
  assert.throws(() => validateExtractionQuestionNumbers(inventory.questionCount, numbers.filter(number => number !== "12")), /缺少第 12 题/);
  assert.throws(() => validateExtractionQuestionNumbers(inventory.questionCount, [...numbers, "21"]));
  assert.throws(() => validateExtractionQuestionNumbers(inventory.questionCount, [...numbers, "22"]));
});

test("扫描/缺失页、题目与答案不一致、混合题号格式或重复题号不能覆盖模型声明数", () => {
  for (const rows of [
    fixture().filter(row => row.page === 1),
    fixture().filter(row => !(row.page === 2 && row.text.startsWith("20．"))),
    fixture().map(row => row.page === 1 && row.text.startsWith("20．") ? { ...row, text: "20．没有分值的另一种格式" } : row),
    fixture().map(row => row.page === 1 && row.text.startsWith("20．") ? { ...row, text: "19．（5分）重复题号" } : row),
    [...fixture(), { page: 2, text: "参考答案与试题解析" }],
  ]) assert.equal(corroborateSourceQuestionInventory(rows, 2), null);
  const rows = [...fixture(), { page: 3, text: "第3页（共21页）" }];
  assert.equal(corroborateSourceQuestionInventory(rows, 3), null);
  assert.throws(() => validateExtractionQuestionNumbers(21, Array.from({ length: 20 }, (_, index) => String(index + 1))), /缺少第 21 题/);
});
