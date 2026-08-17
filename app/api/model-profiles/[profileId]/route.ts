import { and, eq } from "drizzle-orm";
import { getDb, sqliteTransaction } from "../../../../db";
import { modelProfiles } from "../../../../db/schema";
import { ensureOwnerModelSettings, validateModelBaseUrl } from "../../../../lib/model-profiles";
import { normalizeModelProtocol } from "../../../../lib/model-protocols";
import { normalizeOptionalTokenPrice, repriceModelUsageHistory } from "../../../../lib/model-usage";
import { encryptSecret, maskSecret } from "../../../../lib/secret-box";
import { now, requestOwner } from "../../../../lib/server";

type UpdatePayload = {
  displayName?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  inputPricePerMillion?: number | string | null;
  outputPricePerMillion?: number | string | null;
  cachedInputPricePerMillion?: number | string | null;
  cachedOutputPricePerMillion?: number | string | null;
};

function publicProfile<T extends { apiKeyCiphertext?: string | null; apiKeyIv?: string | null }>(profile: T) {
  const safe = { ...profile };
  delete safe.apiKeyCiphertext;
  delete safe.apiKeyIv;
  return safe;
}

export async function DELETE(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const { profileId } = await context.params;
  const db = getDb();
  const profile = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)) });
  if (!profile) return Response.json({ error: "自定义模型配置不存在" }, { status: 404 });
  sqliteTransaction((transaction) => {
    transaction.prepare(
      "UPDATE app_settings SET selected_model_profile_id = NULL, updated_at = ? WHERE owner_id = ? AND selected_model_profile_id = ?",
    ).run(now(), ownerId, profileId);
    transaction.prepare("DELETE FROM model_profiles WHERE id = ? AND owner_id = ?").run(profileId, ownerId);
  });
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const { profileId } = await context.params;
  const payload = await request.json() as UpdatePayload;
  const db = getDb();
  const profile = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)) });
  if (!profile) return Response.json({ error: "模型配置不存在" }, { status: 404 });

  let inputPricePerMillion: number | null;
  let outputPricePerMillion: number | null;
  let cachedInputPricePerMillion: number | null;
  let cachedOutputPricePerMillion: number | null;
  try {
    inputPricePerMillion = payload.inputPricePerMillion === undefined
      ? profile.inputPricePerMillion
      : normalizeOptionalTokenPrice(payload.inputPricePerMillion, "输入价格");
    outputPricePerMillion = payload.outputPricePerMillion === undefined
      ? profile.outputPricePerMillion
      : normalizeOptionalTokenPrice(payload.outputPricePerMillion, "输出价格");
    cachedInputPricePerMillion = payload.cachedInputPricePerMillion === undefined
      ? profile.cachedInputPricePerMillion
      : normalizeOptionalTokenPrice(payload.cachedInputPricePerMillion, "缓存输入价格");
    cachedOutputPricePerMillion = payload.cachedOutputPricePerMillion === undefined
      ? profile.cachedOutputPricePerMillion
      : normalizeOptionalTokenPrice(payload.cachedOutputPricePerMillion, "缓存输出价格");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "价格格式无效" }, { status: 400 });
  }

  let displayName = profile.displayName;
  let provider = profile.provider;
  let baseUrl = profile.baseUrl;
  let model = profile.model;
  let timeoutMs = profile.timeoutMs;
  let apiKeyCiphertext = profile.apiKeyCiphertext;
  let apiKeyIv = profile.apiKeyIv;
  let apiKeyMask = profile.apiKeyMask;
  let connectionChanged = false;

  displayName = payload.displayName?.trim() ?? profile.displayName;
  model = payload.model?.trim() ?? profile.model;
  if (!displayName || !model) return Response.json({ error: "名称和模型名称不能为空" }, { status: 400 });
  try {
    provider = normalizeModelProtocol(payload.provider ?? profile.provider);
    baseUrl = payload.baseUrl === undefined ? profile.baseUrl : validateModelBaseUrl(payload.baseUrl);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型配置无效" }, { status: 400 });
  }
  timeoutMs = Math.max(15000, Math.min(300000, Number(payload.timeoutMs ?? profile.timeoutMs)));
  const apiKey = payload.apiKey?.trim();
  if (apiKey) {
    const encrypted = await encryptSecret(apiKey);
    apiKeyCiphertext = encrypted.ciphertext;
    apiKeyIv = encrypted.iv;
    apiKeyMask = maskSecret(apiKey);
  }
  connectionChanged = displayName !== profile.displayName
    || provider !== profile.provider
    || baseUrl !== profile.baseUrl
    || model !== profile.model
    || timeoutMs !== profile.timeoutMs
    || Boolean(apiKey);

  let repricedEvents = 0;
  try {
    const timestamp = now();
    repricedEvents = sqliteTransaction((transaction) => {
      transaction.prepare(
        `UPDATE model_profiles SET display_name = ?, provider = ?, base_url = ?, model = ?,
           timeout_ms = ?, api_key_ciphertext = ?, api_key_iv = ?, api_key_mask = ?,
           input_price_per_million = ?, output_price_per_million = ?, cache_price_per_million = ?,
           cached_output_price_per_million = ?,
           last_test_status = CASE WHEN ? THEN NULL ELSE last_test_status END,
           last_test_message = CASE WHEN ? THEN NULL ELSE last_test_message END,
           last_tested_at = CASE WHEN ? THEN NULL ELSE last_tested_at END,
           updated_at = ? WHERE id = ? AND owner_id = ?`,
      ).run(
        displayName, provider, baseUrl, model, timeoutMs, apiKeyCiphertext, apiKeyIv, apiKeyMask,
        inputPricePerMillion, outputPricePerMillion, cachedInputPricePerMillion, cachedOutputPricePerMillion,
        connectionChanged ? 1 : 0, connectionChanged ? 1 : 0, connectionChanged ? 1 : 0,
        timestamp, profileId, ownerId,
      );
      return repriceModelUsageHistory(transaction, {
        id: profileId,
        ownerId,
        inputPricePerMillion,
        outputPricePerMillion,
        cachedInputPricePerMillion,
        cachedOutputPricePerMillion,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    if (message.toLowerCase().includes("unique")) return Response.json({ error: "模型配置名称已存在" }, { status: 409 });
    throw error;
  }

  const updated = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)) });
  return Response.json({ profile: updated && publicProfile(updated), repricedEvents });
}
