import { and, eq } from "drizzle-orm";
import { getDb, getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { documents } from "../../../../../db/schema";
import { deleteFile, putFile } from "../../../../../lib/file-storage";
import { PageContentLockedError, savePageRecord } from "../../../../../lib/page-record";
import { now, requestOwner } from "../../../../../lib/server";

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

  const form = await request.formData();
  const page = form.get("page");
  if (!(page instanceof File)) return Response.json({ error: "缺少页面图" }, { status: 400 });
  if (!page.type.startsWith("image/")) return Response.json({ error: "页面文件必须是图片" }, { status: 415 });
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
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  const pageExtension = ({ "image/png": ".png", "image/webp": ".webp" } as Record<string, string>)[page.type] ?? ".jpg";
  const storageKey = `documents/${documentId}/pages/${String(pageNumber).padStart(4, "0")}-${checksum}${pageExtension}`;
  await putFile(storageKey, bytes);

  const sqlite = getSqlite();
  const timestamp = now();
  try {
    const saved = sqliteTransaction((transaction) => savePageRecord(transaction, {
      documentId, ownerId, pageNumber, storageKey, width, height, checksum, timestamp,
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
