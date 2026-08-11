import type Database from "better-sqlite3";
import type { ModelProtocol } from "./model-protocols";

export type ModelTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type ModelTokenPrices = {
  inputPricePerMillion?: number | null;
  outputPricePerMillion?: number | null;
  cachePricePerMillion?: number | null;
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
  if (!usage) return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  if (protocol === "anthropic-messages") {
    const cacheCreation = tokenNumber(usage.cache_creation_input_tokens);
    return {
      inputTokens: tokenNumber(usage.input_tokens) + cacheCreation,
      outputTokens: tokenNumber(usage.output_tokens),
      cachedInputTokens: tokenNumber(usage.cache_read_input_tokens),
    };
  }

  const inputTotal = tokenNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = tokenNumber(usage.output_tokens ?? usage.completion_tokens);
  const details = objectValue(usage.input_tokens_details ?? usage.prompt_tokens_details);
  const cachedInputTokens = Math.min(inputTotal, tokenNumber(
    details?.cached_tokens
      ?? usage.cached_tokens
      ?? usage.cache_read_input_tokens
      ?? usage.prompt_cache_hit_tokens,
  ));
  return {
    inputTokens: Math.max(0, inputTotal - cachedInputTokens),
    outputTokens,
    cachedInputTokens,
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
  const cachePrice = prices.cachePricePerMillion ?? inputPrice;
  const hasPricing = inputPrice !== null || outputPrice !== null || prices.cachePricePerMillion != null;
  if (!hasPricing) return null;
  return (
    usage.inputTokens * (inputPrice ?? 0)
    + usage.outputTokens * (outputPrice ?? 0)
    + usage.cachedInputTokens * (cachePrice ?? 0)
  ) / 1_000_000;
}

export function repriceModelUsageHistory(sqlite: Database.Database, profile: RepriceProfile) {
  const rows = sqlite.prepare(
    `SELECT id, input_tokens AS inputTokens, output_tokens AS outputTokens,
            cached_input_tokens AS cachedInputTokens
       FROM model_usage_events WHERE owner_id = ? AND model_profile_id = ?`,
  ).all(profile.ownerId, profile.id) as Array<ModelTokenUsage & { id: string }>;
  const update = sqlite.prepare(
    `UPDATE model_usage_events SET input_price_per_million = ?, output_price_per_million = ?,
       cache_price_per_million = ?, cost_cny = ? WHERE id = ?`,
  );
  for (const row of rows) {
    update.run(
      profile.inputPricePerMillion ?? null,
      profile.outputPricePerMillion ?? null,
      profile.cachePricePerMillion ?? null,
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
      (id, owner_id, model_profile_id, document_id, page_number, purpose, provider, model,
       input_tokens, output_tokens, cached_input_tokens, input_price_per_million,
       output_price_per_million, cache_price_per_million, cost_cny, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, profile.ownerId, profile.id, context.documentId ?? null, context.pageNumber ?? null,
    context.purpose, profile.provider, profile.model, usage.inputTokens, usage.outputTokens,
    usage.cachedInputTokens, profile.inputPricePerMillion ?? null, profile.outputPricePerMillion ?? null,
    profile.cachePricePerMillion ?? null, costCny, timestamp,
  );
  return { id, costCny };
}
