import type Database from "better-sqlite3";
import type { ModelProtocol } from "./model-protocols";

export type ModelTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cachedOutputTokens: number;
};

export type ModelTokenPrices = {
  inputPricePerMillion?: number | null;
  outputPricePerMillion?: number | null;
  cachedInputPricePerMillion?: number | null;
  cachedOutputPricePerMillion?: number | null;
};

type UsageProfile = ModelTokenPrices & {
  id: string;
  ownerId: string;
  provider: string;
  model: string;
};

type UsageContext = {
  purpose: string;
  documentId?: string;
  pageNumber?: number;
  pageCount?: number;
};

type RepriceProfile = ModelTokenPrices & {
  id: string;
  ownerId: string;
};

function objectValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function tokenNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function extractModelTokenUsage(protocol: ModelProtocol, value: unknown): ModelTokenUsage {
  const result = objectValue(value);
  const usage = objectValue(result?.usage);
  if (!usage) return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cachedOutputTokens: 0 };

  if (protocol === "anthropic-messages") {
    const cacheCreationTokens = tokenNumber(usage.cache_creation_input_tokens);
    const outputTotal = tokenNumber(usage.output_tokens);
    const reportedCachedOutputTokens = tokenNumber(usage.cache_read_output_tokens ?? usage.cached_output_tokens);
    const includedCachedOutputTokens = outputTotal > 0
      ? Math.min(outputTotal, reportedCachedOutputTokens)
      : reportedCachedOutputTokens;
    return {
      inputTokens: tokenNumber(usage.input_tokens),
      outputTokens: Math.max(0, outputTotal - includedCachedOutputTokens),
      cachedInputTokens: tokenNumber(usage.cache_read_input_tokens),
      cachedOutputTokens: cacheCreationTokens + includedCachedOutputTokens,
    };
  }

  const inputTotal = tokenNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTotal = tokenNumber(usage.output_tokens ?? usage.completion_tokens);
  const inputDetails = objectValue(usage.input_tokens_details ?? usage.prompt_tokens_details);
  const outputDetails = objectValue(usage.output_tokens_details ?? usage.completion_tokens_details);
  const cacheDetails = objectValue(usage.cache);
  const reportedIncludedCachedInputTokens = tokenNumber(
    inputDetails?.cached_tokens
      ?? inputDetails?.cache_read_tokens
      ?? inputDetails?.cacheReadTokens
      ?? usage.cached_input_tokens
      ?? usage.cached_tokens
      ?? usage.prompt_cache_hit_tokens,
  );
  const includedCachedInputTokens = inputTotal > 0
    ? Math.min(inputTotal, reportedIncludedCachedInputTokens)
    : reportedIncludedCachedInputTokens;
  const separateCachedInputTokens = tokenNumber(
    usage.cache_read_input_tokens
      ?? usage.cache_read_tokens
      ?? cacheDetails?.read
      ?? cacheDetails?.input,
  );
  const reportedIncludedCachedOutputTokens = tokenNumber(
    outputDetails?.cached_tokens
      ?? usage.cached_output_tokens
      ?? usage.cache_read_output_tokens
      ?? usage.completion_cache_hit_tokens,
  );
  const includedCachedOutputTokens = outputTotal > 0
    ? Math.min(outputTotal, reportedIncludedCachedOutputTokens)
    : reportedIncludedCachedOutputTokens;
  const separateCachedOutputTokens = tokenNumber(
    outputDetails?.cache_write_tokens
      ?? outputDetails?.cacheWriteTokens
      ?? usage.cache_write_output_tokens
      ?? usage.cache_write_tokens
      ?? usage.cache_creation_input_tokens
      ?? cacheDetails?.write
      ?? cacheDetails?.output,
  );
  return {
    inputTokens: Math.max(0, inputTotal - includedCachedInputTokens),
    outputTokens: Math.max(0, outputTotal - includedCachedOutputTokens),
    cachedInputTokens: includedCachedInputTokens + separateCachedInputTokens,
    cachedOutputTokens: includedCachedOutputTokens + separateCachedOutputTokens,
  };
}

export function normalizeOptionalTokenPrice(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new Error(`${label}必须是 0–1000000 之间的数字，或留空`);
  }
  return parsed;
}

export function calculateModelUsageCost(usage: ModelTokenUsage, prices: ModelTokenPrices) {
  const inputPrice = prices.inputPricePerMillion ?? null;
  const outputPrice = prices.outputPricePerMillion ?? null;
  const cachedInputPrice = prices.cachedInputPricePerMillion ?? inputPrice;
  const cachedOutputPrice = prices.cachedOutputPricePerMillion ?? outputPrice;
  const hasPricing = inputPrice !== null || outputPrice !== null
    || prices.cachedInputPricePerMillion != null || prices.cachedOutputPricePerMillion != null;
  if (!hasPricing) return null;
  return (
    usage.inputTokens * (inputPrice ?? 0)
    + usage.outputTokens * (outputPrice ?? 0)
    + usage.cachedInputTokens * (cachedInputPrice ?? 0)
    + usage.cachedOutputTokens * (cachedOutputPrice ?? 0)
  ) / 1_000_000;
}

export function repriceModelUsageHistory(sqlite: Database.Database, profile: RepriceProfile) {
  const rows = sqlite.prepare(
    `SELECT id, input_tokens AS inputTokens, output_tokens AS outputTokens,
            cached_input_tokens AS cachedInputTokens, cached_output_tokens AS cachedOutputTokens
       FROM model_usage_events WHERE owner_id = ? AND model_profile_id = ?`,
  ).all(profile.ownerId, profile.id) as Array<ModelTokenUsage & { id: string }>;
  const update = sqlite.prepare(
    `UPDATE model_usage_events SET input_price_per_million = ?, output_price_per_million = ?,
       cache_price_per_million = ?, cached_output_price_per_million = ?, cost_cny = ? WHERE id = ?`,
  );
  for (const row of rows) {
    update.run(
      profile.inputPricePerMillion ?? null,
      profile.outputPricePerMillion ?? null,
      profile.cachedInputPricePerMillion ?? null,
      profile.cachedOutputPricePerMillion ?? null,
      calculateModelUsageCost(row, profile),
      row.id,
    );
  }
  return rows.length;
}

export function recordModelUsage(
  sqlite: Database.Database,
  profile: UsageProfile,
  usage: ModelTokenUsage,
  context: UsageContext,
  timestamp: string,
) {
  const costCny = calculateModelUsageCost(usage, profile);
  const id = crypto.randomUUID();
  sqlite.prepare(
    `INSERT INTO model_usage_events
      (id, owner_id, model_profile_id, document_id, page_number, page_count, purpose, provider, model,
       input_tokens, output_tokens, cached_input_tokens, cached_output_tokens, input_price_per_million,
       output_price_per_million, cache_price_per_million, cached_output_price_per_million, cost_cny, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, profile.ownerId, profile.id, context.documentId ?? null, context.pageNumber ?? null,
    Math.max(1, Math.trunc(context.pageCount ?? 1)), context.purpose, profile.provider, profile.model,
    usage.inputTokens, usage.outputTokens,
    usage.cachedInputTokens, usage.cachedOutputTokens, profile.inputPricePerMillion ?? null,
    profile.outputPricePerMillion ?? null, profile.cachedInputPricePerMillion ?? null,
    profile.cachedOutputPricePerMillion ?? null, costCny, timestamp,
  );
  return { id, costCny };
}
