import { readJsonPayload } from "../../../../../lib/request-payload";
import { requestOwner } from "../../../../../lib/server";
import { getAssignmentDetail, setAssignmentStatus } from "../../../../../lib/school-workflow";


export async function GET(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  try {
    return Response.json(await getAssignmentDetail(requestOwner(request), (await context.params).assignmentId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "作业不存在" }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const parsed = await readJsonPayload<{ status?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  if (parsed.value.status !== "active" && parsed.value.status !== "closed") return Response.json({ error: "作业状态无效" }, { status: 400 });
  try {
    return Response.json(await setAssignmentStatus(requestOwner(request), (await context.params).assignmentId, parsed.value.status));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "更新作业失败" }, { status: 400 });
  }
}
