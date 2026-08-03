import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, modelProfiles } from "../../../../db/schema";
import { ensureOwnerModelSettings, ownerMimoProfileId } from "../../../../lib/model-profiles";
import { encryptSecret, maskSecret } from "../../../../lib/secret-box";
import { now, requestOwner } from "../../../../lib/server";

export async function DELETE(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const { profileId } = await context.params;
  const db = getDb();
  const profile = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)) });
  if (!profile) return Response.json({ error: "自定义模型配置不存在" }, { status: 404 });
  if (profile.isManaged) return Response.json({ error: "内置模型不可删除" }, { status: 400 });
  await db.delete(modelProfiles).where(and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)));
  await db.update(appSettings).set({ selectedModelProfileId: ownerMimoProfileId(ownerId), updatedAt: now() }).where(and(eq(appSettings.ownerId, ownerId), eq(appSettings.selectedModelProfileId, profileId)));
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const { profileId } = await context.params;
  const payload = await request.json() as { apiKey?: string };
  const apiKey = payload.apiKey?.trim();
  if (!apiKey) return Response.json({ error: "API Key 不能为空" }, { status: 400 });
  const db = getDb();
  const profile = await db.query.modelProfiles.findFirst({ where: and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)) });
  if (!profile) return Response.json({ error: "模型配置不存在" }, { status: 404 });
  if (profile.isManaged) return Response.json({ error: "内置免费模型使用公共凭据，不允许改写 API Key" }, { status: 400 });
  const encrypted = await encryptSecret(apiKey);
  await db.update(modelProfiles).set({
    apiKeyCiphertext: encrypted.ciphertext,
    apiKeyIv: encrypted.iv,
    apiKeyMask: maskSecret(apiKey),
    lastTestStatus: null,
    lastTestMessage: null,
    lastTestedAt: null,
    updatedAt: now(),
  }).where(and(eq(modelProfiles.id, profileId), eq(modelProfiles.ownerId, ownerId)));
  return Response.json({ id: profileId, apiKeyMask: maskSecret(apiKey) });
}
