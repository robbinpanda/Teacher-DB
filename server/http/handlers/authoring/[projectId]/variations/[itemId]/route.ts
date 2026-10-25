import { z } from "zod";
import { ensureDatabase } from "../../../../../../../db/bootstrap";
import { requestOwner } from "../../../../../../../lib/server";
import { requestEducationScope } from "../../../../../../../lib/education-scope";
import { acceptWholePaperItem, retryWholePaperItem } from "../../../../../../services/authoring-variations";
import { readAuthoringProject } from "../../../../../../services/authoring";
import { getVariationRun } from "../../../../../../services/variation-candidates";
export async function GET(request: Request, context: { params: Promise<{projectId:string;itemId:string}> }) {
  await ensureDatabase();
  const {projectId,itemId} = await context.params, owner = requestOwner(request);
  const item = readAuthoringProject(owner, requestEducationScope(request), projectId)?.variation?.items.find(item => item.id === itemId);
  if (!item) return Response.json({ error: "题目不存在" }, { status: 404 });
  return Response.json({ run: item.runId ? await getVariationRun(owner, item.runId) : null });
}
export async function POST(request: Request, context: { params: Promise<{projectId:string;itemId:string}> }) {
  await ensureDatabase();
  const data = z.discriminatedUnion("action", [
    z.object({ action: z.literal("accept"), revision: z.number().int().positive() }).strict(),
    z.object({ action: z.literal("retry"), revision: z.number().int().positive(), feedback: z.string().trim().max(1500).optional() }).strict(),
  ]).safeParse(await request.json().catch(() => null));
  if (!data.success) return Response.json({ error: "操作格式无效" }, { status: 400 });
  const {projectId,itemId} = await context.params;
  try {
    const owner = requestOwner(request), scope = requestEducationScope(request);
    const project = data.data.action === "accept" ? await acceptWholePaperItem(owner, scope, projectId, itemId, data.data.revision)
      : await retryWholePaperItem(owner, scope, projectId, itemId, data.data.revision, data.data.feedback);
    return Response.json({ project });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 409 }); }
}
