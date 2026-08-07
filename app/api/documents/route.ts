import { getDb, sqliteTransaction } from "../../../db";
import { and, eq } from "drizzle-orm";
import { ensureDatabase } from "../../../db/bootstrap";
import { documents } from "../../../db/schema";
import { now, requestOwner } from "../../../lib/server";
import { deleteFile, putFile } from "../../../lib/file-storage";
import { getDocuments } from "../../../lib/question-repository";

export const runtime = "nodejs";

const maxOriginalBytes = 100 * 1024 * 1024;
const acceptedExtensions = [".pdf"];

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  const rows = await getDocuments(requestOwner(request));
  return Response.json({ documents: rows }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "缺少文件" }, { status: 400 });
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!acceptedExtensions.includes(extension)) return Response.json({ error: "当前产品仅支持 PDF 试卷" }, { status: 415 });
  if (file.size > maxOriginalBytes) return Response.json({ error: "原卷不能超过 100 MB" }, { status: 413 });
  const id = crypto.randomUUID();
  const createdAt = now();
  const originalKey = "documents/" + id + "/original/" + file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const pageCount = Number(form.get("pageCount") ?? 0);
  if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 250) {
    return Response.json({ error: "页数必须在 0 到 250 之间" }, { status: 400 });
  }
  const bytes = await file.arrayBuffer();
  if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    return Response.json({ error: "文件扩展名是 PDF，但内容不是有效的 PDF 文件" }, { status: 415 });
  }
  const checksum = hex(await crypto.subtle.digest("SHA-256", bytes));
  const ownerId = requestOwner(request);
  const existing = await getDb().query.documents.findFirst({
    where: and(eq(documents.ownerId, ownerId), eq(documents.checksum, checksum)),
  });
  if (existing) {
    if (pageCount === 0) {
      return Response.json({ id: existing.id, originalKey: existing.originalKey, pageCount: existing.pageCount, duplicate: true, resumed: existing.status !== "complete", status: existing.status });
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
        sourceSchool: String(form.get("sourceSchool") ?? "") || null,
        updatedAt: createdAt,
      }).where(and(eq(documents.id, existing.id), eq(documents.ownerId, ownerId)));
      return Response.json({ id: existing.id, originalKey: existing.originalKey, pageCount, duplicate: true, resumed: true });
    }
    return Response.json({ id: existing.id, originalKey: existing.originalKey, pageCount: existing.pageCount, duplicate: true, resumed: false });
  }
  await putFile(originalKey, bytes);
  try {
    const outcome = sqliteTransaction((transaction) => {
      const racedExisting = transaction.prepare(
        `SELECT id, original_key AS originalKey, page_count AS pageCount, status
           FROM documents WHERE owner_id = ? AND checksum = ? LIMIT 1`,
      ).get(ownerId, checksum) as { id: string; originalKey: string | null; pageCount: number; status: string } | undefined;
      if (racedExisting) return { existing: racedExisting } as const;
      transaction.prepare(
        `INSERT INTO documents
          (id, owner_id, name, mime_type, original_key, status, page_count, subject, grade,
           source_year, source_exam_type, source_region, source_school, checksum, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, ownerId, file.name, file.type || "application/octet-stream", originalKey,
        pageCount > 0 ? "extracting" : "uploading", pageCount,
        String(form.get("subject") ?? "") || null,
        String(form.get("grade") ?? "") || null,
        Number(form.get("sourceYear")) || null,
        String(form.get("sourceExamType") ?? "") || null,
        String(form.get("sourceRegion") ?? "") || null,
        String(form.get("sourceSchool") ?? "") || null,
        checksum, createdAt, createdAt,
      );
      return { existing: null } as const;
    });
    if (outcome.existing) {
      await deleteFile(originalKey).catch(() => undefined);
      return Response.json({
        id: outcome.existing.id,
        originalKey: outcome.existing.originalKey,
        pageCount: outcome.existing.pageCount,
        duplicate: true,
        resumed: outcome.existing.status !== "complete",
        status: outcome.existing.status,
      });
    }
  } catch (error) {
    await deleteFile(originalKey).catch(() => undefined);
    throw error;
  }
  return Response.json({ id, originalKey, pageCount, checksum, duplicate: false }, { status: 201 });
}
