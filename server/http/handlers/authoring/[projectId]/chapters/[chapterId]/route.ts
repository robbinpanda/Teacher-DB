import { z } from "zod";
import { ensureDatabase } from "../../../../../../../db/bootstrap";
import { requestOwner } from "../../../../../../../lib/server";
import { requestEducationScope } from "../../../../../../../lib/education-scope";
import { readAuthoringProject } from "../../../../../../services/authoring";
import { approveAuthoringChapter, editAuthoringChapter, retryAuthoringChapter } from "../../../../../../services/authoring-chapters";

type Context = { params: Promise<{ projectId: string; chapterId: string }> };
const command = z.object({ action: z.enum(["retry", "review", "approve"]), revision: z.number().int().min(1), note: z.string().max(2000).default("") }).strict();
export async function POST(request: Request, context: Context) {
  await ensureDatabase();
  const { projectId, chapterId } = await context.params, owner = requestOwner(request), scope = requestEducationScope(request);
  if (!readAuthoringProject(owner, scope, projectId)?.chapters.some(chapter => chapter.id === chapterId)) return Response.json({ error: "章节不存在" }, { status: 404 });
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "章节操作格式无效" }, { status: 400 });
  try {
    const project = parsed.data.action === "approve" ? approveAuthoringChapter(owner, scope, projectId, chapterId, parsed.data.revision, parsed.data.note)
      : await retryAuthoringChapter(owner, scope, projectId, chapterId, parsed.data.revision, parsed.data.action === "review");
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
