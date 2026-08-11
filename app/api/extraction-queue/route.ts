import { getExtractionQueueSettings, kickExtractionQueue, listDocumentJobs, setExtractionQueueConcurrency, setExtractionQueuePaused } from "../../../lib/extraction-queue";
import { MAX_UPLOAD_CONCURRENCY } from "../../../lib/upload-concurrency";
import { requestOwner } from "../../../lib/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const ownerId = requestOwner(request);
  const [jobs, settings] = await Promise.all([listDocumentJobs(ownerId), getExtractionQueueSettings(ownerId)]);
  void kickExtractionQueue();
  return Response.json({ jobs, ...settings });
}

export async function PATCH(request: Request) {
  const payload = await request.json().catch(() => ({})) as { action?: unknown; concurrency?: unknown };
  if (payload.action === "pause" || payload.action === "resume") {
    const settings = await setExtractionQueuePaused(requestOwner(request), payload.action === "pause");
    if (payload.action === "resume") void kickExtractionQueue();
    return Response.json(settings);
  }
  const concurrency = Number(payload.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_UPLOAD_CONCURRENCY) {
    return Response.json({ error: `同时处理试卷数需要是 1–${MAX_UPLOAD_CONCURRENCY} 的整数` }, { status: 400 });
  }
  const settings = await setExtractionQueueConcurrency(requestOwner(request), concurrency);
  void kickExtractionQueue();
  return Response.json(settings);
}
