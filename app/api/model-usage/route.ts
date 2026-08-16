import { getSqlite } from "../../../db";
import { ensureOwnerModelSettings } from "../../../lib/model-profiles";
import { summarizeModelUsage, type UsageEventRow, type UsageProfileRow } from "../../../lib/model-usage-summary";
import { requestOwner } from "../../../lib/server";

function monthWindow(month: string, timezoneOffset: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("月份格式应为 YYYY-MM");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (year < 2000 || year > 2200 || monthIndex < 0 || monthIndex > 11) throw new Error("月份无效");
  const start = new Date(Date.UTC(year, monthIndex, 1) + timezoneOffset * 60_000).toISOString();
  const end = new Date(Date.UTC(year, monthIndex + 1, 1) + timezoneOffset * 60_000).toISOString();
  return { start, end };
}

export async function GET(request: Request) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const today = url.searchParams.get("today") ?? new Date().toISOString().slice(0, 10);
  const timezoneOffset = Number(url.searchParams.get("timezoneOffset") ?? 0);
  if (!Number.isInteger(timezoneOffset) || timezoneOffset < -840 || timezoneOffset > 840) {
    return Response.json({ error: "时区偏移无效" }, { status: 400 });
  }
  let window: { start: string; end: string };
  try {
    window = monthWindow(month, timezoneOffset);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "月份无效" }, { status: 400 });
  }

  const sqlite = getSqlite();
  const profiles = sqlite.prepare(
    `SELECT id, display_name AS displayName, provider, model,
            input_price_per_million AS inputPricePerMillion,
            output_price_per_million AS outputPricePerMillion,
            cache_price_per_million AS cachedInputPricePerMillion,
            cached_output_price_per_million AS cachedOutputPricePerMillion
       FROM model_profiles WHERE owner_id = ? AND enabled = 1 ORDER BY created_at`,
  ).all(ownerId) as UsageProfileRow[];
  const events = sqlite.prepare(
    `SELECT usage.model_profile_id AS modelProfileId, profile.display_name AS displayName,
            usage.provider, usage.model, usage.purpose, usage.document_id AS documentId,
            usage.page_number AS pageNumber, usage.page_count AS pageCount, usage.input_tokens AS inputTokens,
            usage.output_tokens AS outputTokens, usage.cached_input_tokens AS cachedInputTokens,
            usage.cached_output_tokens AS cachedOutputTokens,
            usage.cost_cny AS costCny, usage.created_at AS createdAt
       FROM model_usage_events usage
       LEFT JOIN model_profiles profile ON profile.id = usage.model_profile_id
      WHERE usage.owner_id = ? AND usage.created_at >= ? AND usage.created_at < ?
      ORDER BY usage.created_at`,
  ).all(ownerId, window.start, window.end) as UsageEventRow[];
  const result = summarizeModelUsage(profiles, events, today, timezoneOffset);
  const trackingStartedAt = sqlite.prepare(
    "SELECT MIN(created_at) AS value FROM model_usage_events WHERE owner_id = ?",
  ).get(ownerId) as { value: string | null } | undefined;
  return Response.json({ month, today, profiles, ...result, trackingStartedAt: trackingStartedAt?.value ?? null });
}
