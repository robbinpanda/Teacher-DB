import { requestOwner } from "../../../../lib/server";
import { getTeachingClass } from "../../../../lib/school-workflow";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ classId: string }> }) {
  try {
    return Response.json({ teachingClass: await getTeachingClass(requestOwner(request), (await context.params).classId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "班级不存在" }, { status: 404 });
  }
}
