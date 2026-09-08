import { readFormDataPayload } from "../../../../../lib/request-payload";
import { parseRosterCsv } from "../../../../../lib/roster-csv";
import { requestOwner } from "../../../../../lib/server";
import { importClassRoster } from "../../../../../lib/school-workflow";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ classId: string }> }) {
  const parsed = await readFormDataPayload(request);
  if (!parsed.ok) return parsed.response;
  const file = parsed.value.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 2 * 1024 * 1024) return Response.json({ error: "请选择不超过 2MB 的 CSV 文件" }, { status: 400 });
  try {
    const rows = parseRosterCsv(await file.text());
    const result = await importClassRoster(requestOwner(request), (await context.params).classId, rows);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "名单导入失败" }, { status: 400 });
  }
}
