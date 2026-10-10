import { result } from "../core/result";
import { getDb, getSqlite, sqliteTransaction } from "../../db";
import { and, eq } from "drizzle-orm";
import { ensureDatabase } from "../../db/bootstrap";
import { documents } from "../../db/schema";
import { now } from "../../lib/server";
import { deleteFile, putFile } from "../../lib/file-storage";
import { findReusableDocument } from "../../lib/document-upload";
import { enqueueDocumentPreparation, processorConfigured } from "./document-preparation";
import { uploadMetadataSchema } from "../../lib/api-contracts";


const maxOriginalBytes = 100 * 1024 * 1024;
const acceptedExtensions = [".pdf"];

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}


export async function uploadDocument(ownerId: string, form: FormData) {
  await ensureDatabase();
  const file = form.get("file");
  if (!(file instanceof File)) return result({ error: "缺少文件" }, { status: 400 });
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!acceptedExtensions.includes(extension)) return result({ error: "当前产品仅支持 PDF 试卷" }, { status: 415 });
  if (file.size > maxOriginalBytes) return result({ error: "原卷不能超过 100 MB" }, { status: 413 });
  if (file.name.length > 180) return result({ error: "文件名不能超过 180 字符" }, { status: 400 });
  const metadata: Record<string, unknown> = {};
  for (const key of ["subject", "grade", "sourceExamType", "sourceRegion", "sourceTextbook", "sourceSchool"]) metadata[key] = form.get(key) ?? "";
  const year = form.get("sourceYear");
  metadata.sourceYear = year === null || year === "" ? null : typeof year === "string" ? Number(year) : year;
  if (!uploadMetadataSchema.safeParse(metadata).success) return result({ error: "试卷信息格式无效或字段过长" }, { status: 400 });
  const id = crypto.randomUUID();
  const createdAt = now();
  const originalKey = "documents/" + id + "/original/" + file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const pageCount = Number(form.get("pageCount") ?? 0);
  const prepare = processorConfigured() && pageCount === 0;
  const profileId = form.get("profileId");
  if (profileId !== null && (typeof profileId !== "string" || profileId.length > 100)) return result({ error: "模型编号格式无效" }, { status: 400 });
  const prepareExisting = async (documentId: string, status: string) => prepare && status !== "complete"
    ? enqueueDocumentPreparation(ownerId, documentId, profileId || undefined) : null;
  if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 250) {
    return result({ error: "页数必须在 0 到 250 之间" }, { status: 400 });
  }
  const bytes = await file.arrayBuffer();
  if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    return result({ error: "文件扩展名是 PDF，但内容不是有效的 PDF 文件" }, { status: 415 });
  }
  const checksum = hex(await crypto.subtle.digest("SHA-256", bytes));
  // A source-only deletion intentionally preserves its questions and checksum.
  // It must not hijack a later upload of the same PDF; that upload gets a new document.
  const existing = findReusableDocument(getSqlite(), ownerId, checksum);
  if (existing) {
    if (pageCount === 0) {
      const preparation = await prepareExisting(existing.id, existing.status);
      if (preparation && preparation.status >= 400) return preparation;
      return result({ id: existing.id, originalKey: existing.originalKey, pageCount: existing.pageCount, duplicate: true, resumed: existing.status !== "complete", status: existing.status, preparationQueued: Boolean(preparation) });
    }
    if (existing.status !== "complete") {
      await getDb().update(documents).set({
        pageCount,
        status: "extracting",
        subject: String(form.get("subject") ?? "") || null,
        grade: String(form.get("grade") ?? "") || null,
        sourceYear: Number(form.get("sourceYear")) || null,
        sourceExamType: String(form.get("sourceExamType") ?? "") || null,
        sourceRegion: String(form.get("sourceRegion") ?? "") || null,
        sourceTextbook: String(form.get("sourceTextbook") ?? "") || null,
        sourceSchool: String(form.get("sourceSchool") ?? "") || null,
        updatedAt: createdAt,
      }).where(and(eq(documents.id, existing.id), eq(documents.ownerId, ownerId)));
      return result({ id: existing.id, originalKey: existing.originalKey, pageCount, duplicate: true, resumed: true });
    }
    return result({ id: existing.id, originalKey: existing.originalKey, pageCount: existing.pageCount, duplicate: true, resumed: false });
  }
  await putFile(originalKey, bytes);
  try {
    const outcome = sqliteTransaction((transaction) => {
      const racedExisting = findReusableDocument(transaction, ownerId, checksum);
      if (racedExisting) return { existing: racedExisting } as const;
      transaction.prepare(
        `INSERT INTO documents
          (id, owner_id, name, mime_type, original_key, status, page_count, subject, grade,
           source_year, source_exam_type, source_region, source_textbook, source_school, checksum, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, ownerId, file.name, file.type || "application/octet-stream", originalKey,
        pageCount > 0 ? "extracting" : "uploading", pageCount,
        String(form.get("subject") ?? "") || null,
        String(form.get("grade") ?? "") || null,
        Number(form.get("sourceYear")) || null,
        String(form.get("sourceExamType") ?? "") || null,
        String(form.get("sourceRegion") ?? "") || null,
        String(form.get("sourceTextbook") ?? "") || null,
        String(form.get("sourceSchool") ?? "") || null,
        checksum, createdAt, createdAt,
      );
      return { existing: null } as const;
    });
    if (outcome.existing) {
      await deleteFile(originalKey).catch(() => undefined);
      const preparation = await prepareExisting(outcome.existing.id, outcome.existing.status);
      if (preparation && preparation.status >= 400) return preparation;
      return result({
        id: outcome.existing.id,
        originalKey: outcome.existing.originalKey,
        pageCount: outcome.existing.pageCount,
        duplicate: true,
        resumed: outcome.existing.status !== "complete",
        status: outcome.existing.status,
        preparationQueued: Boolean(preparation),
      });
    }
  } catch (error) {
    await deleteFile(originalKey).catch(() => undefined);
    throw error;
  }
  const preparation = await prepareExisting(id, "uploading");
  if (preparation && preparation.status >= 400) return preparation;
  return result({ id, originalKey, pageCount, checksum, duplicate: false, preparationQueued: Boolean(preparation) }, { status: 201 });
}
