import { getSqlite } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { getTagCatalog, validTagScope } from "../../../../lib/tag-catalog";
import { now, requestOwner } from "../../../../lib/server";
import { readJsonPayload } from "../../../../lib/request-payload";


export async function GET(request: Request) {
  const url = new URL(request.url);
  const subject = url.searchParams.get("subject")?.trim() || "数学";
  const stage = url.searchParams.get("stage") || "middle";
  if (!validTagScope(stage)) return Response.json({ error: "学段无效" }, { status: 400 });
  return Response.json({ tags: await getTagCatalog(requestOwner(request), subject, stage) });
}

export async function POST(request: Request) {
  const parsed = await readJsonPayload<{ subject?: string; stage?: string; name?: string }>(request);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  if ((payload.subject !== undefined && typeof payload.subject !== "string")
    || (payload.stage !== undefined && typeof payload.stage !== "string")
    || (payload.name !== undefined && typeof payload.name !== "string")) {
    return Response.json({ error: "标签字段格式无效" }, { status: 400 });
  }
  const subject = payload.subject?.trim() || "数学";
  const stage = payload.stage || "middle";
  const name = payload.name?.trim().replace(/^#/, "") || "";
  if (!validTagScope(stage)) return Response.json({ error: "学段无效" }, { status: 400 });
  if (subject.length > 32) return Response.json({ error: "学科名称不能超过 32 个字符" }, { status: 400 });
  if (!name || name.length > 32) return Response.json({ error: "标签需为 1-32 个字符" }, { status: 400 });
  await ensureDatabase();
  getSqlite().prepare(
    "INSERT OR IGNORE INTO tag_catalog (id, owner_id, subject, stage, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), requestOwner(request), subject, stage, name, now());
  return Response.json({ tags: await getTagCatalog(requestOwner(request), subject, stage) }, { status: 201 });
}
