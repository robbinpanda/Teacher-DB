import { statfs } from "node:fs/promises";
import { dataDirectory, getSqlite } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { requestOwner } from "../../../lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const quickCheck = sqlite.pragma("quick_check", { simple: true });
  const foreignKeyErrors = sqlite.pragma("foreign_key_check") as unknown[];
  const ownerId = requestOwner(request);
  const counts = sqlite.prepare(
    `SELECT
      (SELECT COUNT(*) FROM documents WHERE owner_id = ?) AS documents,
      (SELECT COUNT(*) FROM questions q JOIN documents d ON d.id = q.document_id WHERE d.owner_id = ?) AS questions,
      (SELECT COUNT(*) FROM papers WHERE owner_id = ?) AS papers,
      (SELECT COUNT(*) FROM extraction_runs WHERE status = 'running' AND created_at < ?) AS staleRuns`,
  ).get(ownerId, ownerId, ownerId, new Date(Date.now() - 15 * 60 * 1000).toISOString()) as {
    documents: number; questions: number; papers: number; staleRuns: number;
  };
  let freeBytes: number | null = null;
  try {
    const filesystem = await statfs(dataDirectory());
    freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  } catch {}
  const ok = quickCheck === "ok" && foreignKeyErrors.length === 0;
  return Response.json({
    ok,
    timestamp: new Date().toISOString(),
    database: { quickCheck, foreignKeyErrors: foreignKeyErrors.length },
    storage: { freeBytes },
    counts,
  }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
