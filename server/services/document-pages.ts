import { result } from "../core/result";
import { and, eq } from "drizzle-orm";
import { getDb, getSqlite, sqliteTransaction } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import { documents } from "../../db/schema";
import { deleteFile, putFile } from "../../lib/file-storage";
import { PageContentLockedError, savePageRecord } from "../../lib/page-record";
import { now } from "../../lib/server";
import { isPageImageMime, validatePageImage } from "../../lib/page-image";


export async function uploadDocumentPage(ownerId: string, documentId: string, form: FormData, preparationLease?: string) {
  await ensureDatabase();
  const db = getDb();
  const document = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)),
  });
  if (!document) return result({ error: "文档不存在" }, { status: 404 });
  if (document.sourceRemovedAt) return result({ error: "原试卷已删除，不能继续上传页面" }, { status: 409 });

  const page = form.get("page");
  if (!(page instanceof File)) return result({ error: "缺少页面图" }, { status: 400 });
  if (!isPageImageMime(page.type)) return result({ error: "页面图片仅支持 JPEG、PNG 或 WebP" }, { status: 415 });
  if (page.size > 20 * 1024 * 1024) return result({ error: "单页图片不能超过 20 MB" }, { status: 413 });

  const pageNumber = Number(form.get("pageNumber"));
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.pageCount) {
    return result({ error: `页码必须在 1 到 ${document.pageCount} 之间` }, { status: 400 });
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 50_000 || height > 50_000) {
    return result({ error: "页面宽高必须是 1 到 50000 之间的整数" }, { status: 400 });
  }

  const bytes = await page.arrayBuffer();
  let inspected: Awaited<ReturnType<typeof validatePageImage>>;
  try {
    inspected = await validatePageImage(new Uint8Array(bytes), page.type, width, height);
  } catch (error) {
    return result({ error: error instanceof Error ? error.message : "页面图片校验失败" }, { status: 422 });
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  const storageKey = `documents/${documentId}/pages/${String(pageNumber).padStart(4, "0")}-${checksum}${inspected.extension}`;
  await putFile(storageKey, bytes);

  const sqlite = getSqlite();
  const timestamp = now();
  try {
    const saved = sqliteTransaction((transaction) => {
      if (preparationLease && !transaction.prepare(`SELECT 1 FROM document_preparations
        WHERE document_id=? AND owner_id=? AND status='processing' AND lease_owner=? AND lease_expires_at>?`)
        .get(documentId, ownerId, preparationLease, now())) throw new Error("PDF 分页任务已由其他 Worker 接管");
      return savePageRecord(transaction, {
      documentId, ownerId, pageNumber, storageKey, width: inspected.width, height: inspected.height, checksum, timestamp,
      });
    });

    let fileCleanupFailures = 0;
    if (saved.previousStorageKey && saved.previousStorageKey !== storageKey) {
      const cleanup = await Promise.allSettled([deleteFile(saved.previousStorageKey)]);
      fileCleanupFailures = cleanup.filter((result) => result.status === "rejected").length;
    }
    return result(
      { id: saved.pageId, storageKey, pageNumber, checksum, fileCleanupFailures },
      { status: saved.created ? 201 : 200 },
    );
  } catch (error) {
    const referenced = sqlite.prepare("SELECT 1 FROM pages WHERE storage_key = ? LIMIT 1").get(storageKey);
    if (!referenced) await deleteFile(storageKey).catch(() => undefined);
    if (error instanceof PageContentLockedError) return result({ error: error.message }, { status: 409 });
    return result({ error: error instanceof Error ? error.message : "页面保存失败" }, { status: 409 });
  }
}
