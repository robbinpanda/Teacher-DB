import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveExtractionAttempt,
  MAX_EXTRACTION_ATTEMPTS,
  retryDelayMs,
  shouldPauseExtraction,
} from "../lib/extraction-retry.ts";

test("识别失败采用逐步增长的退避时间", () => {
  assert.equal(retryDelayMs(1, undefined, 0), 5_000);
  assert.equal(retryDelayMs(4, undefined, 0), 60_000);
  assert.equal(retryDelayMs(8, undefined, 0), 900_000);
  assert.equal(retryDelayMs(1, 60 * 60_000, 0), 30 * 60_000);
});

test("连续失败达到上限后暂停，等待人工重试", () => {
  assert.equal(MAX_EXTRACTION_ATTEMPTS, 8);
  assert.equal(shouldPauseExtraction(7), false);
  assert.equal(shouldPauseExtraction(8), true);
});

test("模型调用前失败也会按文档任务次数暂停", () => {
  assert.equal(effectiveExtractionAttempt(0, 1), 1);
  assert.equal(effectiveExtractionAttempt(0, MAX_EXTRACTION_ATTEMPTS), MAX_EXTRACTION_ATTEMPTS);
  assert.equal(shouldPauseExtraction(effectiveExtractionAttempt(0, MAX_EXTRACTION_ATTEMPTS)), true);
  assert.equal(effectiveExtractionAttempt(5, 2), 6);
});
