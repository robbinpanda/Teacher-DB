import { and, eq } from "drizzle-orm";
import { getDb, sqliteTransaction } from "../../../../db";
import { modelProfiles } from "../../../../db/schema";
import { ensureOwnerModelSettings, ownerMimoProfileId, validateModelBaseUrl } from "../../../../lib/model-profiles";
import { normalizeModelProtocol } from "../../../../lib/model-protocols";
import { normalizeOptionalTokenPrice } from "../../../../lib/model-usage";
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
  cachePricePerMillion?: number | string | null;
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
  if (profile.isManaged) return Response.json({ error: "内置模型不可删除" }, { status: 400 });
  sqliteTransaction((transaction) => {
    const current = transaction.prepare(
      "SELECT is_managed AS isManaged FROM model_profiles WHERE id = ? AND owner_id = ?",
    ).get(profileId, ownerId) as { isManaged: number } | undefined;
    if (!current || current.isManaged) throw new Error("模型配置在删除前已发生变化");
    transaction.prepare("DELETE FROM model_profiles WHERE id = ? AND owner_id = ?").run(profileId, ownerId);
    transaction.prepare(
      "UPDATE app_settings SET selected_model_profile_id = ?, updated_at = ? WHERE owner_id = ? AND selected_model_profile_id = ?",
    ).run(ownerMimoProfileId(ownerId), now(), ownerId, profileId);
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
  let cachePricePerMillion: number | null;
  try {
    inputPricePerMillion = payload.inputPricePerMillion === undefined
      ? profile.inputPricePerMillion
      : normalizeOptionalTokenPrice(payload.inputPricePerMillion, "输入价格");
    outputPricePerMillion = payload.outputPricePerMillion === undefined
      ? profile.outputPricePerMillion
      : normalizeOptionalTokenPrice(payload.outputPricePerMillion, "输出价格");
    cachePricePerMillion = payload.cachePricePerMillion === undefined
      ? profile.cachePricePerMillion
      : normalizeOptionalTokenPrice(payload.cachePricePerMillion, "缓存价格");
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

  if (!profile.isManaged) {
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
  }

  try {
    await db.update(modelProfiles).set({
      displayName,
      provider,
      baseUrl,
      model,
      timeoutMs,
      apiKeyCiphertext,
      apiKeyIv,
      apiKeyMask,
      inputPricePerMillion,
      outputPricePerMillion,
      cachePricePerMillion,
      ...(connectionChanged ? { lastTestStatus: null, lastTestMessage: null, lastTestedAt: null } : {}),
      updatedAt: now(),
    }).where(and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    if (message.toLowerCase().includes("unique")) return Response.json({ error: "模型配置名称已存在" }, { status: 409 });
    throw error;
  }

  const updated = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)) });
  return Response.json({ profile: updated && publicProfile(updated) });
}
