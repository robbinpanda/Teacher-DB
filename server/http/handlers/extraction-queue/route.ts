import { requestEducationScope } from "../../../../lib/education-scope";
import { getExtractionQueueSettings, kickExtractionQueue, listDocumentJobs, setExtractionQueueConcurrency, setExtractionQueuePaused } from "../../../../lib/extraction-queue";
import { MAX_UPLOAD_CONCURRENCY } from "../../../../lib/upload-concurrency";
import { requestOwner } from "../../../../lib/server";
import { listDocumentPreparations } from "../../../services/document-preparation";
import { setAutomaticAiReviewEnabled } from "../../../../lib/ai-review-settings";


export async function GET(request: Request) {
  const ownerId = requestOwner(request);
  if (new URL(request.url).searchParams.get("summary") === "1") {
    return Response.json(await getExtractionQueueSettings(ownerId, requestEducationScope(request)), { headers: { "cache-control": "no-store" } });
  }
  const [jobs, settings] = await Promise.all([listDocumentJobs(ownerId), getExtractionQueueSettings(ownerId, requestEducationScope(request))]);
  void kickExtractionQueue();
  return Response.json({ jobs, preparations: listDocumentPreparations(ownerId), ...settings });
}

export async function PATCH(request: Request) {
  const payload = await request.json().catch(() => ({})) as { action?: unknown; concurrency?: unknown; automaticAiReviewEnabled?: unknown };
  if ("automaticAiReviewEnabled" in payload) {
    if (typeof payload.automaticAiReviewEnabled !== "boolean") return Response.json({ error: "独立 AI 复核开关必须为布尔值" }, { status: 400 });
    await setAutomaticAiReviewEnabled(requestOwner(request), payload.automaticAiReviewEnabled);
    return Response.json(await getExtractionQueueSettings(requestOwner(request)));
  }
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
