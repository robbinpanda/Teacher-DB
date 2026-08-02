import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { appSettings, modelProfiles } from "../db/schema";
import { decryptSecret } from "./secret-box";
import { now } from "./server";

export const OPENCODE_MIMO_PROFILE_ID = "builtin-opencode-mimo-v2.5-free";
export const OPENCODE_MIMO = {
  displayName: "OpenCode MiMo V2.5 Free",
  provider: "openai-compatible",
  baseUrl: "https://opencode.ai/zen/v1",
  model: "mimo-v2.5-free",
  isManaged: true,
  isMultimodal: true,
  enabled: true,
  timeoutMs: 90000,
} as const;

export function ownerMimoProfileId(ownerId: string) {
  return `${OPENCODE_MIMO_PROFILE_ID}::${ownerId}`;
}

export async function ensureOwnerModelSettings(ownerId: string) {
  await ensureDatabase();
  const db = getDb();
  const timestamp = now();
  const profileId = ownerMimoProfileId(ownerId);
  await db.insert(modelProfiles).values({
    id: profileId,
    ...OPENCODE_MIMO,
    ownerId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing();
  await db.insert(appSettings).values({
    ownerId,
    selectedModelProfileId: profileId,
    updatedAt: timestamp,
  }).onConflictDoNothing();
  const setting = await db.query.appSettings.findFirst({ where: eq(appSettings.ownerId, ownerId) });
  if (setting?.selectedModelProfileId) {
    const selected = await db.query.modelProfiles.findFirst({
      where: and(eq(modelProfiles.id, setting.selectedModelProfileId), eq(modelProfiles.ownerId, ownerId)),
    });
    if (!selected) {
      await db.update(appSettings).set({ selectedModelProfileId: profileId, updatedAt: timestamp }).where(eq(appSettings.ownerId, ownerId));
    }
  }
}

export async function resolveModelProfile(ownerId: string, requestedId?: string) {
  await ensureOwnerModelSettings(ownerId);
  const db = getDb();
  let profileId = requestedId;
  if (!profileId) {
    const setting = await db.query.appSettings.findFirst({ where: eq(appSettings.ownerId, ownerId) });
    profileId = setting?.selectedModelProfileId ?? ownerMimoProfileId(ownerId);
  }
  const profile = await db.query.modelProfiles.findFirst({
    where: and(
      eq(modelProfiles.id, profileId),
      eq(modelProfiles.ownerId, ownerId),
      eq(modelProfiles.enabled, true),
    ),
  });
  if (!profile) throw new Error("所选模型配置不存在或已停用");
  if (!profile.apiKeyCiphertext || !profile.apiKeyIv) {
    throw new Error(profile.isManaged ? "请先在模型设置中绑定 OpenCode Zen API Key" : "该模型配置缺少 API Key");
  }
  const apiKey = await decryptSecret(profile.apiKeyCiphertext, profile.apiKeyIv);
  return { ...profile, apiKey };
}

export function chatCompletionsEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : normalized + "/chat/completions";
}

export function validateModelBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("API Base URL 格式不正确"); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("API Base URL 必须使用 HTTPS；仅本机地址允许 HTTP");
  }
  return url.toString().replace(/\/+$/, "");
}
