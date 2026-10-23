import { z } from "zod";
import { ensureDatabase } from "../../../../../../../db/bootstrap";
import { requestOwner } from "../../../../../../../lib/server";
import { requestEducationScope } from "../../../../../../../lib/education-scope";
import { readAuthoringProject } from "../../../../../../services/authoring";
import { approveAuthoringChapter, editAuthoringChapter, retryAuthoringChapter, restoreAuthoringChapter, replanAuthoringChapter } from "../../../../../../services/authoring-chapters";
import { authoringChapterSchema } from "../../../../../../../lib/authoring-plan";

import { readAuthoringChapterVersion } from "../../../../../../services/authoring-history";

type Context = { params: Promise<{ projectId: string; chapterId: string }> };
const command = z.union([
  z.object({ action: z.enum(["retry", "review", "revise", "approve"]), revision: z.number().int().min(1), note: z.string().max(2000).default("") }).strict(),
  z.object({ action: z.literal("restore"), revision: z.number().int().min(1), projectRevision: z.number().int().min(1), versionId: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("replan"), revision: z.number().int().min(1), projectRevision: z.number().int().min(1), plan: authoringChapterSchema }).strict(),
]);
export async function GET(request: Request, context: Context) {
  await ensureDatabase();
  const { projectId, chapterId } = await context.params;
  const version = readAuthoringChapterVersion(requestOwner(request), requestEducationScope(request), projectId, chapterId, new URL(request.url).searchParams.get("version") ?? "");
  return version ? Response.json({ version, content: version.content }) : Response.json({ error: "版本不存在" }, { status: 404 });
}
export async function POST(request: Request, context: Context) {
  await ensureDatabase();
  const { projectId, chapterId } = await context.params, owner = requestOwner(request), scope = requestEducationScope(request);
  if (!readAuthoringProject(owner, scope, projectId)?.chapters.some(chapter => chapter.id === chapterId)) return Response.json({ error: "章节不存在" }, { status: 404 });
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "章节操作格式无效" }, { status: 400 });
  try {
    const project = parsed.data.action === "approve" ? approveAuthoringChapter(owner, scope, projectId, chapterId, parsed.data.revision, parsed.data.note)
      : parsed.data.action === "replan" ? await replanAuthoringChapter(owner, scope, projectId, chapterId, parsed.data.revision, parsed.data.projectRevision, parsed.data.plan)
      : parsed.data.action === "restore" ? await restoreAuthoringChapter(owner, scope, projectId, chapterId, parsed.data.revision, parsed.data.projectRevision, parsed.data.versionId)
      : await retryAuthoringChapter(owner, scope, projectId, chapterId, parsed.data.revision, parsed.data.action === "retry" ? "generate" : parsed.data.action);
    return Response.json({ project });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "章节操作失败" }, { status: 409 }); }
}
export async function PATCH(request: Request, context: Context) {
  await ensureDatabase();
  const { projectId, chapterId } = await context.params, owner = requestOwner(request), scope = requestEducationScope(request);
  if (!readAuthoringProject(owner, scope, projectId)?.chapters.some(chapter => chapter.id === chapterId)) return Response.json({ error: "章节不存在" }, { status: 404 });
  const parsed = z.object({ revision: z.number().int().min(1), content: z.unknown() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "章节保存格式无效" }, { status: 400 });
  try { return Response.json({ project: await editAuthoringChapter(owner, scope, projectId, chapterId, parsed.data.revision, parsed.data.content) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 409 }); }
}
