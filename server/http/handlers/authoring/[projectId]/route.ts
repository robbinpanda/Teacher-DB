import { z } from "zod";
import { getSqlite } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { requestOwner } from "../../../../../lib/server";
import { requestEducationScope } from "../../../../../lib/education-scope";
import { readAuthoringProject, saveAuthoringPlan, inspectAuthoringCoverage } from "../../../../services/authoring";
import { controlAuthoringProject, publishAuthoringPaper } from "../../../../services/authoring-chapters";
import { controlWholePaperVariation, publishWholePaperVariation } from "../../../../services/authoring-variations";

type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) {
  await ensureDatabase();
  const owner = requestOwner(request), scope = requestEducationScope(request), id = (await context.params).projectId;
  const project = readAuthoringProject(owner, scope, id);
  if (!project) return Response.json({ error: "作品不存在" }, { status: 404 });
  if (new URL(request.url).searchParams.get("coverage") === "1") {
    if (!project.plan) return Response.json({ error: "大纲尚未完成" }, { status: 409 });
    return Response.json({ coverage: inspectAuthoringCoverage(owner, scope, id) });
  }
  return Response.json({ project });
}
export async function PATCH(request: Request, context: Context) {
  await ensureDatabase();
  const data = z.object({ revision: z.number().int().min(1), plan: z.unknown() }).strict().safeParse(await request.json().catch(() => null));
  if (!data.success) return Response.json({ error: "大纲保存格式无效" }, { status: 400 });
  try { return Response.json({ project: saveAuthoringPlan(requestOwner(request), requestEducationScope(request), (await context.params).projectId, data.data.revision, data.data.plan) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 409 }); }
}
export async function POST(request: Request, context: Context) {
  await ensureDatabase();
  const data = z.union([
    z.object({ action: z.literal("retry") }).strict(),
    z.object({ action: z.literal("publish") }).strict(),
    z.object({ action: z.enum(["generate", "pause", "resume"]), revision: z.number().int().min(1) }).strict(),
  ]).safeParse(await request.json().catch(() => null));
  if (!data.success) return Response.json({ error: "操作无效" }, { status: 400 });
  const owner = requestOwner(request), scope = requestEducationScope(request), id = (await context.params).projectId;
  const project = readAuthoringProject(owner, scope, id);
  if (!project) return Response.json({ error: "作品不存在" }, { status: 404 });
  if (data.data.action !== "retry") {
    try {
      if (data.data.action === "publish") return Response.json(project.kind === "variation" ? await publishWholePaperVariation(owner, scope, id) : publishAuthoringPaper(owner, scope, id));
      if (project.kind === "variation") return Response.json({ project: await controlWholePaperVariation(owner, scope, id, data.data.revision, data.data.action) });
      return Response.json({ project: await controlAuthoringProject(owner, scope, id, data.data.revision, data.data.action) });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 409 }); }
  }
  if (project.kind === "variation") return Response.json({ error: "请在对应题目下重新生成" }, { status: 409 });
  const changed = getSqlite().prepare("UPDATE authoring_projects SET status='queued',error=NULL,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND status='failed'")
    .run(new Date().toISOString(), id, owner);
  if (!changed.changes) return Response.json({ error: "任务正在运行或已完成，不需要重复生成" }, { status: 409 });
  return Response.json({ project: readAuthoringProject(owner, scope, id) });
}
