import assert from "node:assert/strict";
import test from "node:test";
import { modelNeedsHumanReview } from "../lib/model-review.ts";

test("只有模型明确返回 false 才判定为无需人工核查", () => {
  assert.equal(modelNeedsHumanReview(false), false);
  assert.equal(modelNeedsHumanReview(true), true);
});

test("缺失、含糊或类型错误的判断一律需要人工核查", () => {
  assert.equal(modelNeedsHumanReview(undefined), true);
  assert.equal(modelNeedsHumanReview(null), true);
  assert.equal(modelNeedsHumanReview("false"), true);
  assert.equal(modelNeedsHumanReview(0), true);
});
