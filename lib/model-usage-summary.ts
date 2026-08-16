export type UsageProfileRow = {
  id: string;
  displayName: string;
  provider: string;
  model: string;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  cachedInputPricePerMillion: number | null;
  cachedOutputPricePerMillion: number | null;
};

export type UsageEventRow = {
  modelProfileId: string | null;
  displayName: string | null;
  provider: string;
  model: string;
  purpose: string;
  documentId: string | null;
  pageNumber: number | null;
  pageCount?: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cachedOutputTokens: number;
  costCny: number | null;
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
  cachedOutputTokens: number;
  totalTokens: number;
  costCny: number;
  pricedEventCount: number;
  processedPages: Set<string>;
  pricedPages: Set<string>;
  pageCostCny: number;
  pagePricedEventCount: number;
  todayTokens: number;
  todayCostCny: number;
  todayPricedEventCount: number;
};

export type ModelUsageSummary = Omit<MutableSummary, "processedPages" | "pricedPages" | "costCny" | "todayCostCny"> & {
  processedPages: number;
  pricedPages: number;
  averageCostPerPage: number | null;
  costCny: number | null;
  todayCostCny: number | null;
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
    cachedOutputTokens: 0,
    totalTokens: 0,
    costCny: 0,
    pricedEventCount: 0,
    processedPages: new Set<string>(),
    pricedPages: new Set<string>(),
    pageCostCny: 0,
    pagePricedEventCount: 0,
    todayTokens: 0,
    todayCostCny: 0,
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
  const daily = new Map<string, Map<string, { tokens: number; costCny: number; pricedEventCount: number }>>();

  for (const event of events) {
    const key = event.modelProfileId ?? `deleted:${event.provider}:${event.model}`;
    const summary = summaries.get(key) ?? createSummary(
      key,
      event.displayName ?? `${event.model}（历史配置）`,
      event.provider,
      event.model,
    );
    summaries.set(key, summary);
    const tokens = event.inputTokens + event.outputTokens + event.cachedInputTokens + event.cachedOutputTokens;
    summary.inputTokens += event.inputTokens;
    summary.outputTokens += event.outputTokens;
    summary.cachedInputTokens += event.cachedInputTokens;
    summary.cachedOutputTokens += event.cachedOutputTokens;
    summary.totalTokens += tokens;
    if (event.costCny !== null) {
      summary.costCny += event.costCny;
      summary.pricedEventCount += 1;
    }
    if (event.purpose === "page_extraction" && event.documentId) {
      const pages = event.pageNumber !== null
        ? [event.pageNumber]
        : Array.from({ length: Math.max(1, Number(event.pageCount ?? 1)) }, (_, index) => index + 1);
      for (const page of pages) summary.processedPages.add(`${event.documentId}:${page}`);
      if (event.costCny !== null) {
        for (const page of pages) summary.pricedPages.add(`${event.documentId}:${page}`);
        summary.pageCostCny += event.costCny;
        summary.pagePricedEventCount += 1;
      }
    }

    const date = localDateKey(event.createdAt, timezoneOffset);
    if (date === today) {
      summary.todayTokens += tokens;
      if (event.costCny !== null) {
        summary.todayCostCny += event.costCny;
        summary.todayPricedEventCount += 1;
      }
    }
    const day = daily.get(date) ?? new Map<string, { tokens: number; costCny: number; pricedEventCount: number }>();
    const point = day.get(key) ?? { tokens: 0, costCny: 0, pricedEventCount: 0 };
    point.tokens += tokens;
    if (event.costCny !== null) {
      point.costCny += event.costCny;
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
      averageCostPerPage: pricedPages > 0 ? summary.pageCostCny / pricedPages : null,
      costCny: summary.pricedEventCount > 0 ? summary.costCny : null,
      todayCostCny: summary.todayPricedEventCount > 0 ? summary.todayCostCny : null,
    };
  });

  return {
    summaries: result,
    daily: Array.from(daily.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({
      date,
      models: Array.from(values.entries()).map(([profileId, point]) => ({
        profileId,
        tokens: point.tokens,
        costCny: point.pricedEventCount > 0 ? point.costCny : null,
      })),
    })),
  };
}
