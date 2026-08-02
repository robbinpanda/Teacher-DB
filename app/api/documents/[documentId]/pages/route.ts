import { getDb } from "../../../../../db";
import { pages } from "../../../../../db/schema";
import { now, runtimeEnv } from "../../../../../lib/server";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  const form = await request.formData();
  const page = form.get("page");
  if (!(page instanceof File)) return Response.json({ error: "缺少页面图" }, { status: 400 });
  const pageNumber = Number(form.get("pageNumber") ?? 1);
  const id = crypto.randomUUID();
  const storageKey = "documents/" + documentId + "/pages/" + String(pageNumber).padStart(4, "0") + ".jpg";
  const bindings = runtimeEnv();
  if (bindings.FILES) {
    await bindings.FILES.put(storageKey, page.stream(), {
      httpMetadata: { contentType: page.type || "image/jpeg" },
      customMetadata: { documentId, pageNumber: String(pageNumber) },
    });
  }
  try {
    await getDb().insert(pages).values({
      id,
      documentId,
      pageNumber,
      storageKey,
      width: Number(form.get("width") ?? 0),
      height: Number(form.get("height") ?? 0),
      createdAt: now(),
    });
  } catch (error) {
    console.warn("Page metadata persistence is unavailable in preview.", error);
  }
  return Response.json({ id, storageKey, pageNumber }, { status: 201 });
}

