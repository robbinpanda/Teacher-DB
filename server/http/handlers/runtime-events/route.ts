import { z } from "zod";
import { runtimeLog } from "../../../../lib/runtime-log.mjs";

const metric = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
const schema = z.object({
  event: z.enum(["start", "sample", "pagehide", "error", "unhandled_rejection", "pdf_start", "pdf_end", "pdf_error"]),
  sessionId: z.string().uuid(), activePdfs: z.number().int().min(0).max(100),
  visibility: z.enum(["visible", "hidden"]), heapUsed: metric, heapTotal: metric, heapLimit: metric,
  domNodes: metric, canvases: metric,
}).strict();

export async function POST(request: Request) {
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return Response.json({ error: "运行诊断格式无效" }, { status: 400 });
  runtimeLog("browser_" + payload.data.event, payload.data);
  return new Response(null, { status: 204 });
}
