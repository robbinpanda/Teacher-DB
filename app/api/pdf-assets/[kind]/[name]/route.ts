import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET(_request: Request, context: { params: Promise<{ kind: string; name: string }> }) {
  const { kind, name } = await context.params;
  if (!["wasm", "cmaps", "standard_fonts"].includes(kind) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await readFile(path.join(process.cwd(), "node_modules", "pdfjs-dist", kind, name));
    return new Response(bytes, { headers: {
      "content-type": name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".js") ? "text/javascript" : "application/octet-stream",
      "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff",
    } });
  } catch { return new Response("Not found", { status: 404 }); }
}
