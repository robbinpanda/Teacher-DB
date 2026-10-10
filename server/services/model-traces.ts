import { dataDirectory, getSqlite } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import { getDocumentModelTrace, listDocumentModelTraces, readDocumentModelTraceContent } from "../../lib/model-trace-reader";

export async function documentModelTraces(request: Request, ownerId: string, documentId: string, traceId?: string, content = false) {
  await ensureDatabase();
  const document = getSqlite().prepare("SELECT id, name FROM documents WHERE id = ? AND owner_id = ?")
    .get(documentId, ownerId) as { id: string; name: string } | undefined;
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (!document) return Response.json({ error: "试卷不存在" }, { status: 404, headers });
  const query = new URL(request.url).searchParams;
  if (!traceId) {
    const before = query.get("before") ?? undefined;
    if (before && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/i.test(before)) return Response.json({ error: "日志分页参数无效" }, { status: 400, headers });
    return Response.json({ document, ...await listDocumentModelTraces(dataDirectory(), ownerId, documentId, before) }, { headers });
  }
  if (!content) {
    const trace = await getDocumentModelTrace(dataDirectory(), ownerId, documentId, traceId);
    return Response.json(trace ? { trace } : { error: "日志不存在" }, { status: trace ? 200 : 404, headers });
  }
  const offsetText = query.get("offset") ?? "0";
  if (!/^\d{1,15}$/.test(offsetText)) return Response.json({ error: "日志内容分页参数无效" }, { status: 400, headers });
  const value = await readDocumentModelTraceContent(dataDirectory(), ownerId, documentId, traceId, query.get("file") ?? "output.txt", Number(offsetText));
  return Response.json(value ?? { error: "日志内容不存在" }, { status: value ? 200 : 404, headers });
}
