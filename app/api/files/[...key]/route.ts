import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { documents } from "../../../../db/schema";
import { contentTypeForKey, getFile } from "../../../../lib/file-storage";
import { requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  if (key[0] !== "documents" || !key[1]) return new Response("Not found", { status: 404 });
  await ensureDatabase();
  const document = await getDb().query.documents.findFirst({
    where: and(eq(documents.id, key[1]), eq(documents.ownerId, requestOwner(request))),
  });
  if (!document) return new Response("Not found", { status: 404 });
  const storageKey = key.join("/");
  try {
    const bytes = await getFile(storageKey);
    return new Response(bytes, {
      headers: {
        "content-type": contentTypeForKey(storageKey),
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return new Response("Not found", { status: 404 });
    throw error;
  }
}
