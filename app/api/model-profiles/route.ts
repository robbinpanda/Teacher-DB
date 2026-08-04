import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { modelProfiles, appSettings } from "../../../db/schema";
import { ensureOwnerModelSettings } from "../../../lib/model-profiles";
import { encryptSecret, maskSecret } from "../../../lib/secret-box";
import { now, requestOwner } from "../../../lib/server";
import { validateModelBaseUrl } from "../../../lib/model-profiles";
import { normalizeModelProtocol } from "../../../lib/model-protocols";

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
  const encrypted = await encryptSecret(apiKey);
  const id = crypto.randomUUID();
  const timestamp = now();
  const timeoutMs = Math.max(15000, Math.min(300000, Number(payload.timeoutMs ?? 90000)));
  const db = getDb();
  try {
    await db.insert(modelProfiles).values({
      id, ownerId, displayName, provider, baseUrl, model,
      apiKeyCiphertext: encrypted.ciphertext, apiKeyIv: encrypted.iv, apiKeyMask: maskSecret(apiKey),
      isManaged: false, isMultimodal: true, enabled: true, timeoutMs, createdAt: timestamp, updatedAt: timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    if (message.toLowerCase().includes("unique")) return Response.json({ error: "模型配置名称已存在" }, { status: 409 });
    throw error;
  }
  if (payload.select !== false) {
    await db.update(appSettings).set({ selectedModelProfileId: id, updatedAt: timestamp }).where(eq(appSettings.ownerId, ownerId));
  }
  const profile = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, id), eq(modelProfiles.ownerId, ownerId)) });
  return Response.json({ profile: profile && publicProfile(profile), selectedProfileId: payload.select === false ? undefined : id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const payload = await request.json() as { selectedProfileId?: string };
  if (!payload.selectedProfileId) return Response.json({ error: "缺少 selectedProfileId" }, { status: 400 });
  const db = getDb();
  const profile = await db.query.modelProfiles.findFirst({
    where: and(
      eq(modelProfiles.id, payload.selectedProfileId),
      eq(modelProfiles.ownerId, ownerId),
      eq(modelProfiles.enabled, true),
    ),
  });
  if (!profile) return Response.json({ error: "模型配置不存在或已停用" }, { status: 404 });
  await db.update(appSettings).set({ selectedModelProfileId: profile.id, updatedAt: now() }).where(eq(appSettings.ownerId, ownerId));
  return Response.json({ selectedProfileId: profile.id });
}
