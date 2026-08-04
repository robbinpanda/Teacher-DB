import { kickExtractionQueue, listDocumentJobs } from "../../../lib/extraction-queue";
import { requestOwner } from "../../../lib/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const jobs = await listDocumentJobs(requestOwner(request));
  void kickExtractionQueue();
  return Response.json({ jobs, concurrency: 2 });
}
