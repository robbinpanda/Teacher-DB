import { getSqlite } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { requestOwner } from "../../../../lib/server";
import { requestEducationScope, documentScopeSql } from "../../../../lib/education-scope";
import { createAuthoringProject } from "../../../services/authoring";

export async function GET(request: Request) {
  await ensureDatabase();
  const owner = requestOwner(request), scope = requestEducationScope(request), filter = documentScopeSql(scope);
  const sqlite = getSqlite();
  const projects = sqlite.prepare("SELECT id,title,kind,status,updated_at AS updatedAt FROM authoring_projects WHERE owner_id=? AND subject=? AND stage=? ORDER BY updated_at DESC LIMIT 100")
    .all(owner, scope.subject, scope.stage);
  const sources = sqlite.prepare(`SELECT d.id,d.name,COUNT(q.id) AS questionCount FROM documents d JOIN questions q ON q.document_id=d.id
    WHERE d.owner_id=?${filter.sql} AND q.status='approved' GROUP BY d.id ORDER BY d.created_at DESC`).all(owner, ...filter.params);
  return Response.json({ projects, sources });
}
export async function POST(request: Request) {
  try { return Response.json({ project: await createAuthoringProject(requestOwner(request), requestEducationScope(request), await request.json()) }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "创建任务失败" }, { status: 400 }); }
}
