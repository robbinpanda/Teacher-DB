import { readJsonPayload } from "../../../lib/request-payload";
import { requestOwner } from "../../../lib/server";
import { createTeachingClass, listTeachingClasses } from "../../../lib/school-workflow";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json({ classes: await listTeachingClasses(requestOwner(request)) });
}

export async function POST(request: Request) {
  const parsed = await readJsonPayload<{ name?: unknown; grade?: unknown; subject?: unknown; schoolYear?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  try {
    return Response.json({ teachingClass: await createTeachingClass(requestOwner(request), parsed.value) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法创建班级" }, { status: 400 });
  }
}
