import { readJsonPayload } from "../../../lib/request-payload";
import { requestOwner } from "../../../lib/server";
import { getTeacherMode, setTeacherMode } from "../../../lib/school-workflow";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json({ mode: await getTeacherMode(requestOwner(request)) });
}

export async function PATCH(request: Request) {
  const parsed = await readJsonPayload<{ mode?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  if (parsed.value.mode !== "personal" && parsed.value.mode !== "school") return Response.json({ error: "工作模式无效" }, { status: 400 });
  return Response.json(await setTeacherMode(requestOwner(request), parsed.value.mode));
}
