import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { modelProfiles } from "../../../../db/schema";
import { ensureOwnerModelSettings } from "../../../../lib/model-profiles";
import { now, requestOwner } from "../../../../lib/server";
import { callVisionModel } from "../../../../lib/vision-model";
import sharp from "sharp";

export const runtime = "nodejs";

async function modelTestImage() {
  const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#ffffff" } })
    .composite([{ input: Buffer.from('<svg width="256" height="256"><text x="36" y="135" font-size="42">TEST 42</text></svg>') }])
    .png().toBuffer();
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
      ownerId,
      profileId: profile.id,
      system: "你是视觉结构化输出连通性测试助手。只输出严格 JSON。",
      text: "确认你能读取图片，并输出 {\"ok\":true,\"text\":\"你看到的短文本\"}。",
      image: await modelTestImage(),
      jsonMode: true,
    });
    const clean = result.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean) as { ok?: boolean; text?: string };
    if (parsed.ok !== true) throw new Error("模型可连接，但未按真实识别流程返回结构化 JSON");
    const message = `真实识别协议测试通过：${String(parsed.text ?? "OK").slice(0, 120)}`;
    await db.update(modelProfiles).set({ lastTestStatus: "success", lastTestMessage: message, lastTestedAt: testedAt, updatedAt: testedAt }).where(eq(modelProfiles.id, profile.id));
    return Response.json({ ok: true, message, testedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    await db.update(modelProfiles).set({ lastTestStatus: "failed", lastTestMessage: message.slice(0, 1000), lastTestedAt: testedAt, updatedAt: testedAt }).where(eq(modelProfiles.id, profile.id));
    return Response.json({ ok: false, error: message, testedAt }, { status: 502 });
  }
}
