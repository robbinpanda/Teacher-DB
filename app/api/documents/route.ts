import { getDb } from "../../../db";
import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase } from "../../../db/bootstrap";
import { documents, questions } from "../../../db/schema";
import { now, requestOwner } from "../../../lib/server";
import { putFile } from "../../../lib/file-storage";

export const runtime = "nodejs";

const maxOriginalBytes = 100 * 1024 * 1024;
const acceptedExtensions = [".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp"];

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const db = getDb();
  const rows = await db.select().from(documents).where(eq(documents.ownerId, ownerId)).orderBy(desc(documents.createdAt));
  const counts = await db.select({ documentId: questions.documentId }).from(questions);
  return Response.json({
    documents: rows.map((document) => ({
      ...document,
      questionCount: counts.filter((item) => item.documentId === document.id).length,
    })),
  });
}

export async function POST(request: Request) {
  await ensureDatabase();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "缺少文件" }, { status: 400 });
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!acceptedExtensions.includes(extension)) return Response.json({ error: "仅支持 PDF、DOCX、PNG、JPG、JPEG 和 WEBP" }, { status: 415 });
  if (file.size > maxOriginalBytes) return Response.json({ error: "原卷不能超过 100 MB" }, { status: 413 });
  const id = crypto.randomUUID();
  const createdAt = now();
  const originalKey = "documents/" + id + "/original/" + file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const pageCount = Number(form.get("pageCount") ?? 0);
  const bytes = await file.arrayBuffer();
  const checksum = hex(await crypto.subtle.digest("SHA-256", bytes));
  const ownerId = requestOwner(request);
  const existing = await getDb().query.documents.findFirst({
    where: and(eq(documents.ownerId, ownerId), eq(documents.checksum, checksum)),
  });
  if (existing) return Response.json({ id: existing.id, originalKey: existing.originalKey, pageCount: existing.pageCount, duplicate: true });
  await putFile(originalKey, bytes);
  await getDb().insert(documents).values({
      id,
      ownerId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      originalKey,
      status: "extracting",
      pageCount,
      subject: String(form.get("subject") ?? "") || null,
      grade: String(form.get("grade") ?? "") || null,
      sourceYear: Number(form.get("sourceYear")) || null,
      sourceExamType: String(form.get("sourceExamType") ?? "") || null,
      sourceRegion: String(form.get("sourceRegion") ?? "") || null,
      sourceSchool: String(form.get("sourceSchool") ?? "") || null,
      checksum,
      createdAt,
      updatedAt: createdAt,
  });
  return Response.json({ id, originalKey, pageCount, checksum, duplicate: false }, { status: 201 });
}
