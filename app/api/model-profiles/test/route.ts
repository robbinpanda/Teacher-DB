import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { modelProfiles } from "../../../../db/schema";
import { ensureOwnerModelSettings } from "../../../../lib/model-profiles";
import { now, requestOwner } from "../../../../lib/server";
import { callVisionModel } from "../../../../lib/vision-model";
import sharp from "sharp";

export const runtime = "nodejs";

async function modelTestImage() {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export async function POST(request: Request) {
  const ownerId = requestOwner(request);
  await ensureOwnerModelSettings(ownerId);
  const payload = await request.json() as { profileId?: string };
  if (!payload.profileId) return Response.json({ error: "缺少 profileId" }, { status: 400 });
  const db = getDb();
  const profile = await db.query.modelProfiles.findFirst({
    where: and(eq(modelProfiles.id, payload.profileId), eq(modelProfiles.ownerId, ownerId)),
  });
  if (!profile) return Response.json({ error: "模型配置不存在" }, { status: 404 });
  const testedAt = now();
  try {
    const result = await callVisionModel({
      ownerId, profileId: profile.id, system: "你是连通性测试助手。", text: "识别这张图片，并只回复 OK。", image: await modelTestImage(),
    });
    const message = result.content.trim().slice(0, 200);
    await db.update(modelProfiles).set({ lastTestStatus: "success", lastTestMessage: message, lastTestedAt: testedAt, updatedAt: testedAt }).where(eq(modelProfiles.id, profile.id));
    return Response.json({ ok: true, message, testedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    await db.update(modelProfiles).set({ lastTestStatus: "failed", lastTestMessage: message.slice(0, 1000), lastTestedAt: testedAt, updatedAt: testedAt }).where(eq(modelProfiles.id, profile.id));
    return Response.json({ ok: false, error: message, testedAt }, { status: 502 });
  }
}
