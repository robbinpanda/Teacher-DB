import { and, eq } from "drizzle-orm";
import { getDb, sqliteTransaction } from "../../../db";
import { modelProfiles, appSettings } from "../../../db/schema";
import { ensureOwnerModelSettings } from "../../../lib/model-profiles";
import { encryptSecret, maskSecret } from "../../../lib/secret-box";
import { now, requestOwner } from "../../../lib/server";
import { validateModelBaseUrl } from "../../../lib/model-profiles";
import { normalizeModelProtocol } from "../../../lib/model-protocols";
import { normalizeOptionalTokenPrice } from "../../../lib/model-usage";

function publicProfile<T extends { provider: string; apiKeyCiphertext?: string | null; apiKeyIv?: string | null }>(profile: T) {
  const safe = { ...profile, provider: normalizeModelProtocol(profile.provider) };
  delete safe.apiKeyCiphertext;
  delete safe.apiKeyIv;
  return safe;
}

export async function GET(request: Request) {
  try {
    const ownerId = requestOwner(request);
    await ensureOwnerModelSettings(ownerId);
    const db = getDb();
    const [profiles, setting] = await Promise.all([
      db.select().from(modelProfiles).where(eq(modelProfiles.ownerId, ownerId)),
      db.query.appSettings.findFirst({ where: eq(appSettings.ownerId, ownerId) }),
    ]);
    return Response.json({ profiles: profiles.map(publicProfile), selectedProfileId: setting?.selectedModelProfileId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型配置读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const payload = await request.json() as {
    displayName?: string; provider?: string; baseUrl?: string; model?: string; apiKey?: string; timeoutMs?: number; select?: boolean;
    inputPricePerMillion?: number | string | null;
    outputPricePerMillion?: number | string | null;
    cachePricePerMillion?: number | string | null;
  };
  const displayName = payload.displayName?.trim();
  const model = payload.model?.trim();
  const apiKey = payload.apiKey?.trim();
  if (!displayName || !model || !apiKey || !payload.baseUrl) {
    return Response.json({ error: "名称、API Base URL、模型名称和 API Key 均为必填项" }, { status: 400 });
  }
  let baseUrl: string;
  try { baseUrl = validateModelBaseUrl(payload.baseUrl); } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "URL 无效" }, { status: 400 });
  }
  let provider;
  try { provider = normalizeModelProtocol(payload.provider ?? "openai-chat-completions"); } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "接口协议无效" }, { status: 400 });
  }
  let inputPricePerMillion: number | null;
  let outputPricePerMillion: number | null;
  let cachePricePerMillion: number | null;
  try {
    inputPricePerMillion = normalizeOptionalTokenPrice(payload.inputPricePerMillion, "输入价格");
    outputPricePerMillion = normalizeOptionalTokenPrice(payload.outputPricePerMillion, "输出价格");
    cachePricePerMillion = normalizeOptionalTokenPrice(payload.cachePricePerMillion, "缓存价格");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "价格格式无效" }, { status: 400 });
  }
  const encrypted = await encryptSecret(apiKey);
  const id = crypto.randomUUID();
  const timestamp = now();
  const timeoutMs = Math.max(15000, Math.min(300000, Number(payload.timeoutMs ?? 90000)));
  try {
    sqliteTransaction((transaction) => {
      transaction.prepare(
        `INSERT INTO model_profiles
          (id, owner_id, display_name, provider, base_url, model, api_key_ciphertext, api_key_iv, api_key_mask,
           is_managed, is_multimodal, enabled, timeout_ms, input_price_per_million,
           output_price_per_million, cache_price_per_million, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, ownerId, displayName, provider, baseUrl, model, encrypted.ciphertext, encrypted.iv,
        maskSecret(apiKey), timeoutMs, inputPricePerMillion, outputPricePerMillion,
        cachePricePerMillion, timestamp, timestamp,
      );
      if (payload.select !== false) {
        transaction.prepare("UPDATE app_settings SET selected_model_profile_id = ?, updated_at = ? WHERE owner_id = ?")
          .run(id, timestamp, ownerId);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    if (message.toLowerCase().includes("unique")) return Response.json({ error: "模型配置名称已存在" }, { status: 409 });
    throw error;
  }
  const db = getDb();
  const profile = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, id), eq(modelProfiles.ownerId, ownerId)) });
  return Response.json({ profile: profile && publicProfile(profile), selectedProfileId: payload.select === false ? undefined : id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const payload = await request.json() as { selectedProfileId?: string };
  if (!payload.selectedProfileId) return Response.json({ error: "缺少 selectedProfileId" }, { status: 400 });
  const selected = sqliteTransaction((transaction) => {
    const profile = transaction.prepare(
      "SELECT id FROM model_profiles WHERE id = ? AND owner_id = ? AND enabled = 1",
    ).get(payload.selectedProfileId, ownerId) as { id: string } | undefined;
    if (!profile) return null;
    transaction.prepare("UPDATE app_settings SET selected_model_profile_id = ?, updated_at = ? WHERE owner_id = ?")
      .run(profile.id, now(), ownerId);
    return profile.id;
  });
  if (!selected) return Response.json({ error: "模型配置不存在或已停用" }, { status: 404 });
  return Response.json({ selectedProfileId: selected });
}
