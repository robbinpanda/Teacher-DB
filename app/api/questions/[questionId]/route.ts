import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb, getSqlite } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { assets, questions, questionTags, tags } from "../../../../db/schema";
import { getFile, putFile } from "../../../../lib/file-storage";
import { now, requestOwner } from "../../../../lib/server";
import type { BoundingBox, Question } from "../../../../lib/types";

export const runtime = "nodejs";

function safeBox(box: BoundingBox): BoundingBox {
  const x = Math.max(0, Math.min(99.9, Number(box.x) || 0));
  const y = Math.max(0, Math.min(99.9, Number(box.y) || 0));
  return {
    x,
    y,
    width: Math.max(0.1, Math.min(100 - x, Number(box.width) || 0.1)),
    height: Math.max(0.1, Math.min(100 - y, Number(box.height) || 0.1)),
  };
}

export async function PUT(request: Request, context: { params: Promise<{ questionId: string }> }) {
  await ensureDatabase();
  const { questionId } = await context.params;
  const payload = await request.json() as Question;
  const ownerId = requestOwner(request);
  const sqlite = getSqlite();
  const ownedQuestion = sqlite.prepare(
    `SELECT q.document_id AS documentId FROM questions q
       JOIN documents d ON d.id = q.document_id
      WHERE q.id = ? AND d.owner_id = ?`,
  ).get(questionId, ownerId) as { documentId: string } | undefined;
  if (!ownedQuestion) return Response.json({ error: "题目不存在" }, { status: 404 });
  if (!new Set(["pending", "approved", "needs_attention"]).has(payload.status)) {
    return Response.json({ error: "非法审核状态" }, { status: 400 });
  }

  const preparedAssets: Array<{
    asset: Question["assets"][number];
    box: BoundingBox;
    pageId: string;
    sourceKey: string;
    cropKey: string;
  }> = [];
  try {
    for (const asset of payload.assets) {
      const box = safeBox(asset.bbox);
      const page = sqlite.prepare(
        `SELECT id, storage_key AS storageKey FROM pages WHERE document_id = ? AND page_number = ?`,
      ).get(ownedQuestion.documentId, asset.page) as { id: string; storageKey: string } | undefined;
      if (!page) throw new Error(`找不到题图对应的第 ${asset.page} 页原图`);
      const sourceBytes = await getFile(page.storageKey);
      const image = sharp(sourceBytes, { failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) throw new Error(`无法读取第 ${asset.page} 页图像尺寸`);
      const left = Math.min(metadata.width - 1, Math.max(0, Math.floor(metadata.width * box.x / 100)));
      const top = Math.min(metadata.height - 1, Math.max(0, Math.floor(metadata.height * box.y / 100)));
      const width = Math.max(1, Math.min(metadata.width - left, Math.round(metadata.width * box.width / 100)));
      const height = Math.max(1, Math.min(metadata.height - top, Math.round(metadata.height * box.height / 100)));
      const cropBytes = await image.extract({ left, top, width, height }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const cropKey = `documents/${ownedQuestion.documentId}/crops/${questionId}/${asset.id}.jpg`;
      await putFile(cropKey, cropBytes);
      preparedAssets.push({ asset, box, pageId: page.id, sourceKey: page.storageKey, cropKey });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "题图裁剪失败" }, { status: 422 });
  }

  const db = getDb();
  await db.update(questions).set({
    number: payload.number,
    type: payload.type,
    stem: payload.stem,
    optionsJson: JSON.stringify(payload.options ?? []),
    answer: payload.answer,
    analysis: payload.analysis,
    bboxJson: JSON.stringify(safeBox(payload.bbox)),
    status: payload.status,
    score: payload.score ?? 0,
    updatedAt: now(),
  }).where(eq(questions.id, questionId));

  for (const prepared of preparedAssets) {
    await db.insert(assets).values({
      id: prepared.asset.id,
      questionId,
      pageId: prepared.pageId,
      kind: prepared.asset.kind,
      label: prepared.asset.label,
      sourceKey: prepared.sourceKey,
      cropKey: prepared.cropKey,
      bboxJson: JSON.stringify(prepared.box),
      createdAt: now(),
    }).onConflictDoUpdate({
      target: assets.id,
      set: {
        pageId: prepared.pageId,
        bboxJson: JSON.stringify(prepared.box),
        label: prepared.asset.label,
        kind: prepared.asset.kind,
        sourceKey: prepared.sourceKey,
        cropKey: prepared.cropKey,
      },
    });
  }
  const retainedAssetIds = new Set(preparedAssets.map((item) => item.asset.id));
  const existingAssets = await db.select({ id: assets.id }).from(assets).where(eq(assets.questionId, questionId));
  for (const existing of existingAssets) {
    if (!retainedAssetIds.has(existing.id)) await db.delete(assets).where(and(eq(assets.id, existing.id), eq(assets.questionId, questionId)));
  }

  await db.delete(questionTags).where(eq(questionTags.questionId, questionId));
  for (const name of Array.from(new Set(payload.tags.map((tag) => tag.trim()).filter(Boolean)))) {
    const existing = await db.query.tags.findFirst({ where: eq(tags.name, name) });
    const tagId = existing?.id ?? crypto.randomUUID();
    if (!existing) await db.insert(tags).values({ id: tagId, name, createdAt: now() });
    await db.insert(questionTags).values({ questionId, tagId }).onConflictDoNothing();
  }

  return Response.json({
    question: {
      ...payload,
      assets: preparedAssets.map(({ asset, box, sourceKey, cropKey }) => ({
        ...asset,
        bbox: box,
        sourceKey,
        cropKey,
        url: "/api/files/" + cropKey.split("/").map(encodeURIComponent).join("/"),
      })),
    },
    saved: true,
  });
}
