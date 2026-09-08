import { requestOwner } from "../../../../../../lib/server";
import { removeStudentFromClass } from "../../../../../../lib/school-workflow";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ classId: string; studentId: string }> }) {
  try {
    const { classId, studentId } = await context.params;
    return Response.json(await removeStudentFromClass(requestOwner(request), classId, studentId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "移除学生失败" }, { status: 400 });
  }
}
