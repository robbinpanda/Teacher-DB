import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency, normalizeUploadConcurrency } from "../lib/upload-concurrency.ts";

test("上传并发数量限制在 1 到 100", () => {
  assert.equal(normalizeUploadConcurrency(0), 1);
  assert.equal(normalizeUploadConcurrency("8"), 8);
  assert.equal(normalizeUploadConcurrency(101), 100);
  assert.equal(normalizeUploadConcurrency("invalid"), 2);
});

test("批处理不会超过教师选择的并发数并保持结果顺序", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
});
