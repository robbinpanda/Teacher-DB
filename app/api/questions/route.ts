import { searchApprovedQuestions } from "../../../lib/question-repository";
import { requestOwner } from "../../../lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year")) || undefined;
  const result = await searchApprovedQuestions(requestOwner(request), {
    query: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    documentId: url.searchParams.get("documentId") ?? undefined,
    subject: url.searchParams.get("subject") ?? undefined,
    grade: url.searchParams.get("grade") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    year,
    examType: url.searchParams.get("examType") ?? undefined,
    region: url.searchParams.get("region") ?? undefined,
    school: url.searchParams.get("school") ?? undefined,
    page: Number(url.searchParams.get("page")) || 1,
    pageSize: Number(url.searchParams.get("pageSize")) || 30,
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
