import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { appSettings, modelProfiles } from "../db/schema";
import { decryptSecret, encryptSecret } from "./secret-box";
import { now } from "./server";
import { normalizeModelProtocol } from "./model-protocols";

export const OPENCODE_MIMO_PROFILE_ID = "builtin-opencode-mimo-v2.5-free";
export const OPENCODE_PUBLIC_API_KEY = "public";
export const OPENCODE_PUBLIC_API_KEY_MASK = "public";
export const OPENCODE_MIMO = {
  displayName: "OpenCode MiMo V2.5 Free",
  provider: "openai-chat-completions",
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
  const existingProfile = await db.query.modelProfiles.findFirst({
    where: and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)),
  });
  if (!existingProfile) {
    const encrypted = await encryptSecret(OPENCODE_PUBLIC_API_KEY);
    await db.insert(modelProfiles).values({
      id: profileId,
      ...OPENCODE_MIMO,
      ownerId,
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      apiKeyMask: OPENCODE_PUBLIC_API_KEY_MASK,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).onConflictDoNothing();
  } else if (
    existingProfile.apiKeyMask !== OPENCODE_PUBLIC_API_KEY_MASK
    || !existingProfile.apiKeyCiphertext
    || !existingProfile.apiKeyIv
    || existingProfile.provider !== OPENCODE_MIMO.provider
    || existingProfile.baseUrl !== OPENCODE_MIMO.baseUrl
    || existingProfile.model !== OPENCODE_MIMO.model
  ) {
    const encrypted = await encryptSecret(OPENCODE_PUBLIC_API_KEY);
    await db.update(modelProfiles).set({
      ...OPENCODE_MIMO,
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      apiKeyMask: OPENCODE_PUBLIC_API_KEY_MASK,
      lastTestStatus: null,
      lastTestMessage: null,
      lastTestedAt: null,
      updatedAt: timestamp,
    }).where(and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)));
  }
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
    throw new Error(profile.isManaged ? "OpenCode 公共凭据初始化失败" : "该模型配置缺少 API Key");
  }
  const apiKey = await decryptSecret(profile.apiKeyCiphertext, profile.apiKeyIv);
  return { ...profile, provider: normalizeModelProtocol(profile.provider), apiKey };
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
