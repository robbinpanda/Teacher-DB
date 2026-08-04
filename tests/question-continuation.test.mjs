import assert from "node:assert/strict";
import test from "node:test";
import { mergeContinuationText, mergeQuestionOptions } from "../lib/question-continuation.ts";

test("三页文字按顺序追加到同一题，重复页不会重复写入", () => {
  const firstTwoPages = mergeContinuationText("第一页题干", "第二页题干");
  const allPages = mergeContinuationText(firstTwoPages, "第三页解析");
  assert.equal(allPages, "第一页题干\n第二页题干\n第三页解析");
  assert.equal(mergeContinuationText(allPages, "第三页解析"), allPages);
});

test("重叠的跨页文字只保留一份", () => {
  assert.equal(
    mergeContinuationText("已知条件，下面继续讨论函数的单调性", "下面继续讨论函数的单调性并求最大值"),
    "已知条件，下面继续讨论函数的单调性并求最大值",
  );
});

test("跨页选项按选项字母合并", () => {
  const options = mergeQuestionOptions(
    JSON.stringify([{ key: "A", content: "第一段" }]),
    [{ key: "A", content: "第二段" }, { key: "B", content: "完整选项" }],
  );
  assert.deepEqual(options, [
    { key: "A", content: "第一段\n第二段" },
    { key: "B", content: "完整选项" },
  ]);
});
