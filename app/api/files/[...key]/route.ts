import { contentTypeForKey, getFile } from "../../../../lib/file-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
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
