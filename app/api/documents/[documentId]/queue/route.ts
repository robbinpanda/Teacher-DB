import { enqueueDocumentExtraction } from "../../../../../lib/extraction-queue";
import { requestOwner } from "../../../../../lib/server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  const payload = await request.json().catch(() => ({})) as { profileId?: string; retry?: boolean };
  try {
    const job = await enqueueDocumentExtraction({
      ownerId: requestOwner(request),
      documentId,
      profileId: payload.profileId,
      retry: payload.retry,
    });
    return Response.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法加入识别队列";
    return Response.json({ error: message }, { status: /不存在/.test(message) ? 404 : 400 });
  }
}
