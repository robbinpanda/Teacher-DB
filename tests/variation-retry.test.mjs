import test from "node:test";
import assert from "node:assert/strict";
import { withVariationRetry, textModelTimeout } from "../lib/variation-retry.ts";

const transient = (retryAfterMs) => Object.assign(new Error("模型调用超时"), { retryable: true, retryAfterMs });

test("候选生成等待时限延长且有上限，普通调用保持原时限", () => {
  assert.equal(textModelTimeout(90000), 90000);
  assert.equal(textModelTimeout(90000, 15000), 15000);
  assert.equal(textModelTimeout(90000, undefined, 180000), 180000);
  assert.equal(textModelTimeout(240000, undefined, 180000), 240000);
  assert.equal(textModelTimeout(90000, undefined, 900000), 300000);
});

test("临时超时重试一次后返回结果，并尊重 Retry-After", async () => {
  let calls = 0, retries = 0; const waits = [];
  assert.equal(await withVariationRetry(async () => { if (++calls === 1) throw transient(2500); return "done"; }, { onRetry: () => retries++, wait: async ms => { waits.push(ms); } }), "done");
  assert.equal(calls, 2); assert.equal(retries, 1); assert.deepEqual(waits, [2500]);
});

test("重复超时最多两次调用，且明确告知已重试", async () => {
  let calls = 0;
  await assert.rejects(withVariationRetry(async () => { calls++; throw transient(); }, { wait: async () => {} }), /已自动重试 1 次/);
  assert.equal(calls, 2);
});

test("质量失败、鉴权失败及过长限流等待均不自动重试", async () => {
  for (const error of [new Error("未达到 75 分"), Object.assign(new Error("401"), {retryable:false}), transient(31000), transient(NaN)]) {
    let calls = 0;
    await assert.rejects(withVariationRetry(async () => { calls++; throw error; }, { wait: async () => assert.fail("不应等待") }), e => e === error);
    assert.equal(calls, 1);
  }
});
