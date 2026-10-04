import { readJsonPayload } from "../../../../lib/request-payload";
import { requestOwner } from "../../../../lib/server";
import { getTeachingClass, updateTeachingClass } from "../../../../lib/school-workflow";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    return Response.json({ teachingClass: await getTeachingClass(requestOwner(request), (await context.params).classId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "班级不存在" }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ classId: string }> }) {
  const parsed = await readJsonPayload(request);
  if (!parsed.ok) return parsed.response;
  try {
    const classId = (await context.params).classId;
    await updateTeachingClass(requestOwner(request), classId, parsed.value);
    return Response.json({ teachingClass: await getTeachingClass(requestOwner(request), classId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "班级更新失败" }, { status: 400 });
  }
}
