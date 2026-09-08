import { readJsonPayload } from "../../../lib/request-payload";
import { requestOwner } from "../../../lib/server";
import { createAssignment, listAssignments } from "../../../lib/school-workflow";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json({ assignments: await listAssignments(requestOwner(request)) });
}

export async function POST(request: Request) {
  const parsed = await readJsonPayload<{ paperId?: unknown; title?: unknown; classIds?: unknown; dueAt?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  try {
    return Response.json({ assignment: await createAssignment(requestOwner(request), parsed.value) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "布置作业失败" }, { status: 400 });
  }
}
