import { getDb } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { pages } from "../../../../../db/schema";
import { now } from "../../../../../lib/server";
import { putFile } from "../../../../../lib/file-storage";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const form = await request.formData();
  const page = form.get("page");
  if (!(page instanceof File)) return Response.json({ error: "缺少页面图" }, { status: 400 });
  if (!page.type.startsWith("image/")) return Response.json({ error: "页面文件必须是图片" }, { status: 415 });
  if (page.size > 20 * 1024 * 1024) return Response.json({ error: "单页图片不能超过 20 MB" }, { status: 413 });
  const pageNumber = Number(form.get("pageNumber") ?? 1);
  const id = crypto.randomUUID();
  const pageExtension = ({ "image/png": ".png", "image/webp": ".webp" } as Record<string, string>)[page.type] ?? ".jpg";
  const storageKey = "documents/" + documentId + "/pages/" + String(pageNumber).padStart(4, "0") + pageExtension;
  const bytes = await page.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const checksum = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  await putFile(storageKey, bytes);
  const db = getDb();
  const existing = await db.query.pages.findFirst({
    where: (table, operators) => operators.and(operators.eq(table.documentId, documentId), operators.eq(table.pageNumber, pageNumber)),
  });
  const pageId = existing?.id ?? id;
  await db.insert(pages).values({
      id: pageId,
      documentId,
      pageNumber,
      storageKey,
      width: Number(form.get("width") ?? 0),
      height: Number(form.get("height") ?? 0),
      status: "ready",
      checksum,
      createdAt: now(),
    }).onConflictDoUpdate({
      target: [pages.documentId, pages.pageNumber],
      set: {
        storageKey,
        width: Number(form.get("width") ?? 0),
        height: Number(form.get("height") ?? 0),
        status: "ready",
        checksum,
      },
    });
  return Response.json({ id: pageId, storageKey, pageNumber, checksum }, { status: existing ? 200 : 201 });
}
