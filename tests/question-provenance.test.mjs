import assert from "node:assert/strict";
import test from "node:test";
import { isVariationQuestion } from "../lib/question-provenance.ts";

test("原题可以生成变式，而本地关联、外部来源和历史标记均禁止继续改写", () => {
  assert.equal(isVariationQuestion({ parentQuestionId: null, parentExternalId: null, variationKind: null }), false);
  for (const question of [
    { parentQuestionId: "local-parent" },
    { parentExternalId: "missing-external-parent" },
    { parentQuestionId: null, variationKind: "similar:改变数值" },
    { variationReview: { mode: "rules", status: "rules_passed" } },
  ]) assert.equal(isVariationQuestion(question), true);
});
