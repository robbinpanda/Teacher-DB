import { and, eq } from "drizzle-orm";
import { getDb, getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { documents } from "../../../../../db/schema";
import { deleteFile, putFile } from "../../../../../lib/file-storage";
import { PageContentLockedError, savePageRecord } from "../../../../../lib/page-record";
import { now, requestOwner } from "../../../../../lib/server";
import { readFormDataPayload } from "../../../../../lib/request-payload";
import { isPageImageMime, validatePageImage } from "../../../../../lib/page-image";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const db = getDb();
  const document = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)),
  });
  if (!document) return Response.json({ error: "文档不存在" }, { status: 404 });
  if (document.sourceRemovedAt) return Response.json({ error: "原试卷已删除，不能继续上传页面" }, { status: 409 });

  const parsed = await readFormDataPayload(request);
  if (!parsed.ok) return parsed.response;
  const form = parsed.value;
  const page = form.get("page");
  if (!(page instanceof File)) return Response.json({ error: "缺少页面图" }, { status: 400 });
  if (!isPageImageMime(page.type)) return Response.json({ error: "页面图片仅支持 JPEG、PNG 或 WebP" }, { status: 415 });
  if (page.size > 20 * 1024 * 1024) return Response.json({ error: "单页图片不能超过 20 MB" }, { status: 413 });

  const pageNumber = Number(form.get("pageNumber"));
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.pageCount) {
    return Response.json({ error: `页码必须在 1 到 ${document.pageCount} 之间` }, { status: 400 });
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 50_000 || height > 50_000) {
    return Response.json({ error: "页面宽高必须是 1 到 50000 之间的整数" }, { status: 400 });
  }

  const bytes = await page.arrayBuffer();
  let inspected: Awaited<ReturnType<typeof validatePageImage>>;
  try {
    inspected = await validatePageImage(new Uint8Array(bytes), page.type, width, height);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "页面图片校验失败" }, { status: 422 });
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  const storageKey = `documents/${documentId}/pages/${String(pageNumber).padStart(4, "0")}-${checksum}${inspected.extension}`;
  await putFile(storageKey, bytes);

  const sqlite = getSqlite();
  const timestamp = now();
  try {
    const saved = sqliteTransaction((transaction) => savePageRecord(transaction, {
      documentId, ownerId, pageNumber, storageKey, width: inspected.width, height: inspected.height, checksum, timestamp,
    }));

    let fileCleanupFailures = 0;
    if (saved.previousStorageKey && saved.previousStorageKey !== storageKey) {
      const cleanup = await Promise.allSettled([deleteFile(saved.previousStorageKey)]);
      fileCleanupFailures = cleanup.filter((result) => result.status === "rejected").length;
    }
    return Response.json(
      { id: saved.pageId, storageKey, pageNumber, checksum, fileCleanupFailures },
      { status: saved.created ? 201 : 200 },
    );
  } catch (error) {
    const referenced = sqlite.prepare("SELECT 1 FROM pages WHERE storage_key = ? LIMIT 1").get(storageKey);
    if (!referenced) await deleteFile(storageKey).catch(() => undefined);
    if (error instanceof PageContentLockedError) return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "页面保存失败" }, { status: 409 });
  }
}
