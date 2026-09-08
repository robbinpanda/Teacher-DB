import { readJsonPayload } from "../../../../../lib/request-payload";
import { requestOwner } from "../../../../../lib/server";
import { saveSubmissionScores } from "../../../../../lib/school-workflow";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const parsed = await readJsonPayload<{ submissionId?: unknown; scores?: unknown; teacherComment?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  if (typeof parsed.value.submissionId !== "string" || !parsed.value.submissionId) return Response.json({ error: "学生作答编号无效" }, { status: 400 });
  try {
    return Response.json(await saveSubmissionScores(requestOwner(request), (await context.params).assignmentId, parsed.value.submissionId, parsed.value));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存得分失败" }, { status: 400 });
  }
}
