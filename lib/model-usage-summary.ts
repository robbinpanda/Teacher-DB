export type UsageProfileRow = {
  id: string;
  displayName: string;
  provider: string;
  model: string;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  cachePricePerMillion: number | null;
};

export type UsageEventRow = {
  modelProfileId: string | null;
  displayName: string | null;
  provider: string;
  model: string;
  purpose: string;
  documentId: string | null;
  pageNumber: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
  createdAt: string;
};

type MutableSummary = {
  profileId: string;
  displayName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  costUsd: number;
  pricedEventCount: number;
  processedPages: Set<string>;
  pricedPages: Set<string>;
  pageCostUsd: number;
  pagePricedEventCount: number;
  todayTokens: number;
  todayCostUsd: number;
  todayPricedEventCount: number;
};

export type ModelUsageSummary = Omit<MutableSummary, "processedPages" | "pricedPages" | "costUsd" | "todayCostUsd"> & {
  processedPages: number;
  pricedPages: number;
  averageCostPerPage: number | null;
  costUsd: number | null;
  todayCostUsd: number | null;
};

export function localDateKey(isoTimestamp: string, timezoneOffset: number) {
  return new Date(Date.parse(isoTimestamp) - timezoneOffset * 60_000).toISOString().slice(0, 10);
}

function createSummary(profileId: string, displayName: string, provider: string, model: string): MutableSummary {
  return {
    profileId,
    displayName,
    provider,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    pricedEventCount: 0,
    processedPages: new Set<string>(),
    pricedPages: new Set<string>(),
    pageCostUsd: 0,
    pagePricedEventCount: 0,
    todayTokens: 0,
    todayCostUsd: 0,
    todayPricedEventCount: 0,
  };
}

export function summarizeModelUsage(
  profiles: UsageProfileRow[],
  events: UsageEventRow[],
  today: string,
  timezoneOffset: number,
) {
  const summaries = new Map<string, MutableSummary>();
  for (const profile of profiles) {
    summaries.set(profile.id, createSummary(profile.id, profile.displayName, profile.provider, profile.model));
  }
  const daily = new Map<string, Map<string, { tokens: number; costUsd: number; pricedEventCount: number }>>();

  for (const event of events) {
    const key = event.modelProfileId ?? `deleted:${event.provider}:${event.model}`;
    const summary = summaries.get(key) ?? createSummary(
      key,
      event.displayName ?? `${event.model}（历史配置）`,
      event.provider,
      event.model,
    );
    summaries.set(key, summary);
    const tokens = event.inputTokens + event.outputTokens + event.cachedInputTokens;
    summary.inputTokens += event.inputTokens;
    summary.outputTokens += event.outputTokens;
    summary.cachedInputTokens += event.cachedInputTokens;
    summary.totalTokens += tokens;
    if (event.costUsd !== null) {
      summary.costUsd += event.costUsd;
      summary.pricedEventCount += 1;
    }
    if (event.purpose === "page_extraction" && event.documentId && event.pageNumber !== null) {
      summary.processedPages.add(`${event.documentId}:${event.pageNumber}`);
      if (event.costUsd !== null) {
        summary.pricedPages.add(`${event.documentId}:${event.pageNumber}`);
        summary.pageCostUsd += event.costUsd;
        summary.pagePricedEventCount += 1;
      }
    }

    const date = localDateKey(event.createdAt, timezoneOffset);
    if (date === today) {
      summary.todayTokens += tokens;
      if (event.costUsd !== null) {
        summary.todayCostUsd += event.costUsd;
        summary.todayPricedEventCount += 1;
      }
    }
    const day = daily.get(date) ?? new Map<string, { tokens: number; costUsd: number; pricedEventCount: number }>();
    const point = day.get(key) ?? { tokens: 0, costUsd: 0, pricedEventCount: 0 };
    point.tokens += tokens;
    if (event.costUsd !== null) {
      point.costUsd += event.costUsd;
      point.pricedEventCount += 1;
    }
    day.set(key, point);
    daily.set(date, day);
  }

  const result: ModelUsageSummary[] = Array.from(summaries.values()).map((summary) => {
    const processedPages = summary.processedPages.size;
    const pricedPages = summary.pricedPages.size;
    return {
      ...summary,
      processedPages,
      pricedPages,
      averageCostPerPage: pricedPages > 0 ? summary.pageCostUsd / pricedPages : null,
      costUsd: summary.pricedEventCount > 0 ? summary.costUsd : null,
      todayCostUsd: summary.todayPricedEventCount > 0 ? summary.todayCostUsd : null,
    };
  });

  return {
    summaries: result,
    daily: Array.from(daily.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({
      date,
      models: Array.from(values.entries()).map(([profileId, point]) => ({
        profileId,
        tokens: point.tokens,
        costUsd: point.pricedEventCount > 0 ? point.costUsd : null,
      })),
    })),
  };
}
