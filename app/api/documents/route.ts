import { getDb } from "../../../db";
import { documents } from "../../../db/schema";
import { now, requestOwner, runtimeEnv } from "../../../lib/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "缺少文件" }, { status: 400 });
  const id = crypto.randomUUID();
  const createdAt = now();
  const originalKey = "documents/" + id + "/original/" + file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const pageCount = Number(form.get("pageCount") ?? 0);
  const bindings = runtimeEnv();
  if (bindings.FILES) {
    await bindings.FILES.put(originalKey, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { originalName: file.name, documentId: id },
    });
  }
  try {
    await getDb().insert(documents).values({
      id,
      ownerId: requestOwner(request),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      originalKey,
      status: "extracting",
      pageCount,
      createdAt,
      updatedAt: createdAt,
    });
  } catch (error) {
    console.warn("Document metadata persistence is unavailable in preview.", error);
  }
  return Response.json({ id, originalKey, pageCount }, { status: 201 });
}

