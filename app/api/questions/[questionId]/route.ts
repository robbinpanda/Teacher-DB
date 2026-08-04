import sharp from "sharp";
import { getSqlite, sqliteTransaction } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { deleteFile, getFile, putFile } from "../../../../lib/file-storage";
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
  const requestedRegions = payload.regions?.length ? payload.regions : [{ page: payload.page, bbox: payload.bbox }];
  const preparedRegions: Array<{ page: number; pageId: string; bbox: BoundingBox; position: number }> = [];
  try {
    for (const region of requestedRegions) {
      if (preparedRegions.some((candidate) => candidate.page === region.page)) continue;
      const page = sqlite.prepare(
        "SELECT id FROM pages WHERE document_id = ? AND page_number = ?",
      ).get(ownedQuestion.documentId, region.page) as { id: string } | undefined;
      if (!page) throw new Error(`找不到题目范围对应的第 ${region.page} 页原图`);
      preparedRegions.push({ page: region.page, pageId: page.id, bbox: safeBox(region.bbox), position: preparedRegions.length });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "题目页面范围无效" }, { status: 422 });
  }
  if (!preparedRegions.length) return Response.json({ error: "题目至少需要一个页面范围" }, { status: 400 });
  const primaryRegion = preparedRegions[0];
  const previousAssets = sqlite.prepare(
    "SELECT id, crop_key AS cropKey FROM question_assets WHERE question_id = ?",
  ).all(questionId) as Array<{ id: string; cropKey: string | null }>;

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
      const cropKey = `documents/${ownedQuestion.documentId}/crops/${questionId}/${asset.id}-${crypto.randomUUID()}.jpg`;
      await putFile(cropKey, cropBytes);
      preparedAssets.push({ asset, box, pageId: page.id, sourceKey: page.storageKey, cropKey });
    }
  } catch (error) {
    await Promise.allSettled(preparedAssets.map((prepared) => deleteFile(prepared.cropKey)));
    return Response.json({ error: error instanceof Error ? error.message : "题图裁剪失败" }, { status: 422 });
  }

  const timestamp = now();
  const tagNames = Array.from(new Set(payload.tags.map((tag) => tag.trim()).filter(Boolean)));
  try {
    sqliteTransaction((transaction) => {
      transaction.prepare(
        `UPDATE questions SET number = ?, type = ?, stem = ?, options_json = ?, answer = ?, analysis = ?,
           bbox_json = ?, status = ?, confidence = ?, score = ?, updated_at = ? WHERE id = ?`,
      ).run(
        payload.number, payload.type, payload.stem, JSON.stringify(payload.options ?? []), payload.answer,
        payload.analysis, JSON.stringify(primaryRegion.bbox), payload.status,
        Math.max(0, Math.min(1, Number(payload.confidence) || 0)), 0, timestamp, questionId,
      );
      transaction.prepare("DELETE FROM question_regions WHERE question_id = ?").run(questionId);
      for (const region of preparedRegions) {
        transaction.prepare(
          `INSERT INTO question_regions (id, question_id, page_id, page_number, bbox_json, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(crypto.randomUUID(), questionId, region.pageId, region.page, JSON.stringify(region.bbox), region.position, timestamp);
      }
      for (const prepared of preparedAssets) {
        transaction.prepare(
          `INSERT INTO question_assets
            (id, question_id, page_id, kind, label, source_key, crop_key, bbox_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET page_id = excluded.page_id, kind = excluded.kind,
             label = excluded.label, source_key = excluded.source_key, crop_key = excluded.crop_key,
             bbox_json = excluded.bbox_json`,
        ).run(
          prepared.asset.id, questionId, prepared.pageId, prepared.asset.kind, prepared.asset.label,
          prepared.sourceKey, prepared.cropKey, JSON.stringify(prepared.box), timestamp,
        );
      }
      if (preparedAssets.length) {
        transaction.prepare(
          `DELETE FROM question_assets WHERE question_id = ? AND id NOT IN (${preparedAssets.map(() => "?").join(",")})`,
        ).run(questionId, ...preparedAssets.map((prepared) => prepared.asset.id));
      } else {
        transaction.prepare("DELETE FROM question_assets WHERE question_id = ?").run(questionId);
      }
      transaction.prepare("DELETE FROM question_tags WHERE question_id = ?").run(questionId);
      for (const name of tagNames) {
        transaction.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(crypto.randomUUID(), name, timestamp);
        transaction.prepare(
          "INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
        ).run(questionId, name);
      }
    });
  } catch (error) {
    await Promise.allSettled(preparedAssets.map((prepared) => deleteFile(prepared.cropKey)));
    const duplicateNumber = typeof error === "object" && error !== null && "code" in error
      && String(error.code).includes("SQLITE_CONSTRAINT_UNIQUE");
    return Response.json(
      { error: duplicateNumber ? `题号 ${payload.number} 已存在，请使用唯一题号` : error instanceof Error ? error.message : "题目保存失败" },
      { status: duplicateNumber ? 409 : 500 },
    );
  }
  const retainedCropKeys = new Set(preparedAssets.map((prepared) => prepared.cropKey));
  await Promise.allSettled(previousAssets.filter((asset) => asset.cropKey && !retainedCropKeys.has(asset.cropKey)).map((asset) => deleteFile(asset.cropKey!)));

  return Response.json({
    question: {
      ...payload,
      page: primaryRegion.page,
      bbox: primaryRegion.bbox,
      regions: preparedRegions.map((region) => ({ page: region.page, bbox: region.bbox })),
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
