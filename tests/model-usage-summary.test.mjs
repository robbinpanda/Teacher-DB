import assert from "node:assert/strict";
import test from "node:test";
import { localDateKey, summarizeModelUsage } from "../lib/model-usage-summary.ts";

const profiles = [{
  id: "model-a",
  displayName: "Model A",
  provider: "openai-responses",
  model: "vision-a",
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
  cachePricePerMillion: null,
}];

test("localDateKey applies the browser timezone offset", () => {
  assert.equal(localDateKey("2026-08-10T16:30:00.000Z", -480), "2026-08-11");
});

test("usage summary counts unique processed pages and includes retries in page cost", () => {
  const common = {
    modelProfileId: "model-a",
    displayName: "Model A",
    provider: "openai-responses",
    model: "vision-a",
    purpose: "page_extraction",
    documentId: "paper-1",
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 10,
  };
  const result = summarizeModelUsage(profiles, [
    { ...common, pageNumber: 1, costCny: 0.01, createdAt: "2026-08-11T01:00:00.000Z" },
    { ...common, pageNumber: 1, costCny: 0.02, createdAt: "2026-08-11T01:01:00.000Z" },
    { ...common, pageNumber: 2, costCny: 0.03, createdAt: "2026-08-11T01:02:00.000Z" },
  ], "2026-08-11", -480);
  const summary = result.summaries[0];
  assert.equal(summary.processedPages, 2);
  assert.equal(summary.totalTokens, 390);
  assert.ok(Math.abs(summary.averageCostPerPage - 0.03) < 1e-12);
  assert.ok(Math.abs(summary.todayCostCny - 0.06) < 1e-12);
});

test("unpriced usage reports tokens without inventing costs", () => {
  const result = summarizeModelUsage(profiles, [{
    modelProfileId: "model-a",
    displayName: "Model A",
    provider: "openai-responses",
    model: "vision-a",
    purpose: "page_extraction",
    documentId: "paper-2",
    pageNumber: 1,
    inputTokens: 500,
    outputTokens: 100,
    cachedInputTokens: 0,
    costCny: null,
    createdAt: "2026-08-11T02:00:00.000Z",
  }], "2026-08-11", -480);
  assert.equal(result.summaries[0].todayTokens, 600);
  assert.equal(result.summaries[0].costCny, null);
  assert.equal(result.summaries[0].averageCostPerPage, null);
});

test("average page cost excludes pages captured before pricing was configured", () => {
  const common = {
    modelProfileId: "model-a", displayName: "Model A", provider: "openai-responses", model: "vision-a",
    purpose: "page_extraction", documentId: "paper-3", inputTokens: 100, outputTokens: 20, cachedInputTokens: 0,
    createdAt: "2026-08-11T03:00:00.000Z",
  };
  const result = summarizeModelUsage(profiles, [
    { ...common, pageNumber: 1, costCny: null },
    { ...common, pageNumber: 2, costCny: 0.04 },
  ], "2026-08-11", -480);
  assert.equal(result.summaries[0].processedPages, 2);
  assert.equal(result.summaries[0].pricedPages, 1);
  assert.equal(result.summaries[0].averageCostPerPage, 0.04);
});
