import assert from "node:assert/strict";
import test from "node:test";
import { availableQueueCapacity, createDynamicConcurrencyController, mapWithConcurrency, normalizeUploadConcurrency } from "../lib/upload-concurrency.ts";

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

test("降低并发后不打断运行中任务，并在任务收敛后采用新上限", async () => {
  const started = [];
  const releases = new Map();
  const controller = createDynamicConcurrencyController([1, 2, 3, 4, 5, 6], 3, async (value) => {
    started.push(value);
    await new Promise((resolve) => releases.set(value, resolve));
    return value;
  });
  assert.deepEqual(started, [1, 2, 3]);
  controller.setConcurrency(1);
  releases.get(1)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3]);
  releases.get(2)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3]);
  releases.get(3)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3, 4]);
  controller.setConcurrency(2);
  assert.deepEqual(started, [1, 2, 3, 4, 5]);
  releases.get(4)();
  await new Promise((resolve) => setImmediate(resolve));
  releases.get(5)();
  await new Promise((resolve) => setImmediate(resolve));
  releases.get(6)();
  assert.deepEqual(await controller.promise, [1, 2, 3, 4, 5, 6]);
});

test("后端容量按已应用上限和当前运行数计算", () => {
  assert.equal(availableQueueCapacity(4, 1), 3);
  assert.equal(availableQueueCapacity(2, 5), 0);
  assert.equal(availableQueueCapacity(3, -1), 3);
});
