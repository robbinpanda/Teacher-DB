import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { appSettings, modelProfiles } from "../db/schema";
import { decryptSecret } from "./secret-box";
import { now } from "./server";
import { normalizeModelProtocol } from "./model-protocols";

export async function ensureOwnerModelSettings(ownerId: string) {
  await ensureDatabase();
  const db = getDb();
  const timestamp = now();
  await db.insert(appSettings).values({
    ownerId,
    updatedAt: timestamp,
  }).onConflictDoNothing();
  const setting = await db.query.appSettings.findFirst({ where: eq(appSettings.ownerId, ownerId) });
  if (setting?.selectedModelProfileId) {
    const selected = await db.query.modelProfiles.findFirst({
      where: and(eq(modelProfiles.id, setting.selectedModelProfileId), eq(modelProfiles.ownerId, ownerId)),
    });
    if (!selected) {
      await db.update(appSettings).set({ selectedModelProfileId: null, updatedAt: timestamp }).where(eq(appSettings.ownerId, ownerId));
    }
  }
}

export async function resolveModelProfile(ownerId: string, requestedId?: string) {
  await ensureOwnerModelSettings(ownerId);
  const db = getDb();
  let profileId = requestedId;
  if (!profileId) {
    const setting = await db.query.appSettings.findFirst({ where: eq(appSettings.ownerId, ownerId) });
    profileId = setting?.selectedModelProfileId ?? undefined;
  }
  if (!profileId) throw new Error("尚未配置或选择识题模型，请先到“模型设置”填写 API Key、API Base URL 和模型名称");
  const profile = await db.query.modelProfiles.findFirst({
    where: and(
      eq(modelProfiles.id, profileId),
      eq(modelProfiles.ownerId, ownerId),
      eq(modelProfiles.enabled, true),
    ),
  });
  if (!profile) throw new Error("所选模型配置不存在或已停用");
  if (!profile.apiKeyCiphertext || !profile.apiKeyIv) {
    throw new Error("该模型配置缺少 API Key");
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
