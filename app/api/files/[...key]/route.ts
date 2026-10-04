import { and, eq } from "drizzle-orm";
import { getDb, getSqlite } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { documents } from "../../../../db/schema";
import { contentTypeForKey, getFile } from "../../../../lib/file-storage";
import { requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  if (!key.length) return new Response("Not found", { status: 404 });
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const storageKey = key.join("/");
  let authorized = false;
  if (key[0] === "documents" && key[1]) {
    authorized = Boolean(await getDb().query.documents.findFirst({
      where: and(eq(documents.id, key[1]), eq(documents.ownerId, ownerId)),
      columns: { id: true },
    }));
  } else if (key[0] === "imports" && key[1] && key[2]) {
    authorized = Boolean(getSqlite().prepare(
      `SELECT 1 FROM question_assets qa
        JOIN questions q ON q.id = qa.question_id
        JOIN documents d ON d.id = q.document_id
       WHERE qa.crop_key = ? AND d.owner_id = ? LIMIT 1`,
    ).get(storageKey, ownerId));
  }
  if (key[0] === "teaching-skills") {
    authorized = Boolean(getSqlite().prepare("SELECT 1 FROM teaching_skills WHERE sample_key = ? AND owner_id = ?").get(storageKey, ownerId));
  }
  if (!authorized) return new Response("Not found", { status: 404 });
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
