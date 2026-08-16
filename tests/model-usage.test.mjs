import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  calculateModelUsageCost,
  extractModelTokenUsage,
  normalizeOptionalTokenPrice,
  recordModelUsage,
  repriceModelUsageHistory,
} from "../lib/model-usage.ts";

test("解析 Chat Completions 输入、输出与缓存 Token", () => {
  assert.deepEqual(extractModelTokenUsage("openai-chat-completions", {
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 200 },
      completion_tokens_details: { cached_tokens: 50 },
    },
  }), { inputTokens: 1000, outputTokens: 250, cachedInputTokens: 200, cachedOutputTokens: 50 });
});

test("解析 Responses 和 Anthropic Token 用量", () => {
  assert.deepEqual(extractModelTokenUsage("openai-responses", {
    usage: { input_tokens: 900, output_tokens: 100, input_tokens_details: { cached_tokens: 400 } },
  }), { inputTokens: 500, outputTokens: 100, cachedInputTokens: 400, cachedOutputTokens: 0 });
  assert.deepEqual(extractModelTokenUsage("anthropic-messages", {
    usage: { input_tokens: 500, output_tokens: 80, cache_creation_input_tokens: 100, cache_read_input_tokens: 300 },
  }), { inputTokens: 500, outputTokens: 80, cachedInputTokens: 300, cachedOutputTokens: 100 });
});

test("缓存输出字段缺失时记为零，也兼容独立的缓存读写字段", () => {
  assert.deepEqual(extractModelTokenUsage("openai-responses", {
    usage: { input_tokens: 100, output_tokens: 20 },
  }), { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, cachedOutputTokens: 0 });
  assert.deepEqual(extractModelTokenUsage("openai-responses", {
    usage: { input_tokens: 100, output_tokens: 0, cache: { read: 20, write: 30 } },
  }), { inputTokens: 100, outputTokens: 0, cachedInputTokens: 20, cachedOutputTokens: 30 });
});

test("按百万 Token 单价计算费用，缓存价格留空时分别回退输入与输出价格", () => {
  assert.equal(calculateModelUsageCost(
    { inputTokens: 1_000_000, outputTokens: 500_000, cachedInputTokens: 250_000, cachedOutputTokens: 100_000 },
    { inputPricePerMillion: 2, outputPricePerMillion: 6, cachedInputPricePerMillion: 1, cachedOutputPricePerMillion: 3 },
  ), 5.55);
  assert.equal(calculateModelUsageCost(
    { inputTokens: 1_000_000, outputTokens: 500_000, cachedInputTokens: 500_000, cachedOutputTokens: 250_000 },
    { inputPricePerMillion: 2, outputPricePerMillion: 6 },
  ), 7.5);
  assert.equal(calculateModelUsageCost(
    { inputTokens: 1, outputTokens: 1, cachedInputTokens: 1, cachedOutputTokens: 1 },
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

test("保存模型价格后重算该模型的全部历史调用", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE model_usage_events (
      id TEXT PRIMARY KEY, owner_id TEXT, model_profile_id TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER, cached_output_tokens INTEGER,
      input_price_per_million REAL, output_price_per_million REAL,
      cache_price_per_million REAL, cached_output_price_per_million REAL, cost_cny REAL
    );
    INSERT INTO model_usage_events VALUES
      ('a-1', 'owner', 'model-a', 1000000, 500000, 250000, 100000, NULL, NULL, NULL, NULL, NULL),
      ('a-2', 'owner', 'model-a', 500000, 0, 500000, 0, 1, 1, 1, 1, 1),
      ('b-1', 'owner', 'model-b', 1000000, 0, 0, 0, NULL, NULL, NULL, NULL, NULL);
  `);
  const changed = sqlite.transaction(() => repriceModelUsageHistory(sqlite, {
    id: "model-a", ownerId: "owner", inputPricePerMillion: 2,
    outputPricePerMillion: 6, cachedInputPricePerMillion: 1, cachedOutputPricePerMillion: 3,
  }))();
  assert.equal(changed, 2);
  assert.deepEqual(
    sqlite.prepare("SELECT id, cost_cny AS cost FROM model_usage_events ORDER BY id").all(),
    [{ id: "a-1", cost: 5.55 }, { id: "a-2", cost: 1.5 }, { id: "b-1", cost: null }],
  );
  sqlite.close();
});

test("整卷调用记录实际处理页数", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE model_usage_events (
    id TEXT PRIMARY KEY, owner_id TEXT, model_profile_id TEXT, document_id TEXT, page_number INTEGER,
    page_count INTEGER, purpose TEXT, provider TEXT, model TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER, cached_output_tokens INTEGER,
    input_price_per_million REAL, output_price_per_million REAL, cache_price_per_million REAL,
    cached_output_price_per_million REAL, cost_cny REAL, created_at TEXT
  )`);
  recordModelUsage(sqlite, {
    id: "model-a", ownerId: "owner", provider: "openai-chat-completions", model: "vision",
    inputPricePerMillion: 2, outputPricePerMillion: 6,
  }, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, cachedOutputTokens: 0 }, {
    purpose: "page_extraction", documentId: "doc", pageCount: 20,
  }, "2026-08-16T00:00:00.000Z");
  assert.deepEqual(sqlite.prepare(
    "SELECT page_number AS pageNumber, page_count AS pageCount, purpose FROM model_usage_events",
  ).get(), { pageNumber: null, pageCount: 20, purpose: "page_extraction" });
  sqlite.close();
});
