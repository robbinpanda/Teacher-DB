import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateModelUsageCost,
  extractModelTokenUsage,
  normalizeOptionalTokenPrice,
} from "../lib/model-usage.ts";

test("解析 Chat Completions 输入、输出与缓存 Token", () => {
  assert.deepEqual(extractModelTokenUsage("openai-chat-completions", {
    usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 } },
  }), { inputTokens: 1000, outputTokens: 300, cachedInputTokens: 200 });
});

test("解析 Responses 和 Anthropic Token 用量", () => {
  assert.deepEqual(extractModelTokenUsage("openai-responses", {
    usage: { input_tokens: 900, output_tokens: 100, input_tokens_details: { cached_tokens: 400 } },
  }), { inputTokens: 500, outputTokens: 100, cachedInputTokens: 400 });
  assert.deepEqual(extractModelTokenUsage("anthropic-messages", {
    usage: { input_tokens: 500, output_tokens: 80, cache_creation_input_tokens: 100, cache_read_input_tokens: 300 },
  }), { inputTokens: 600, outputTokens: 80, cachedInputTokens: 300 });
});

test("按百万 Token 单价计算费用，缓存价格留空时回退输入价格", () => {
  assert.equal(calculateModelUsageCost(
    { inputTokens: 1_000_000, outputTokens: 500_000, cachedInputTokens: 250_000 },
    { inputPricePerMillion: 2, outputPricePerMillion: 6, cachePricePerMillion: 1 },
  ), 5.25);
  assert.equal(calculateModelUsageCost(
    { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 },
    { inputPricePerMillion: 2 },
  ), 3);
  assert.equal(calculateModelUsageCost(
    { inputTokens: 1, outputTokens: 1, cachedInputTokens: 1 },
    {},
  ), null);
});

test("价格字段允许留空和零，但拒绝负数或非数字", () => {
  assert.equal(normalizeOptionalTokenPrice("", "输入价格"), null);
  assert.equal(normalizeOptionalTokenPrice("0", "输入价格"), 0);
  assert.equal(normalizeOptionalTokenPrice("2.5", "输入价格"), 2.5);
  assert.throws(() => normalizeOptionalTokenPrice("-1", "输入价格"));
  assert.throws(() => normalizeOptionalTokenPrice("abc", "输入价格"));
});
