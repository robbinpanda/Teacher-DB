import { requestEducationScope } from "../../../../lib/education-scope";
import { uploadDocument } from "../../../services/document-upload";
import { getDocumentPage } from "../../../../lib/question-repository";
import type { DocumentListOptions } from "../../../../lib/document-list";
import { toResponse } from "../../../core/result";
import { readFormDataPayload } from "../../../../lib/request-payload";
import { requestOwner } from "../../../../lib/server";


export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return Response.json(await getDocumentPage(requestOwner(request), {
    scope: requestEducationScope(request),
    page: Number(params.get("page") ?? 1), pageSize: Number(params.get("pageSize") ?? 50),
    group: params.get("group") as DocumentListOptions["group"], sort: params.get("sort") as DocumentListOptions["sort"], search: params.get("search") ?? "",
  }), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const payload = await readFormDataPayload(request);
  if (!payload.ok) return payload.response;
  return toResponse(await uploadDocument(requestOwner(request), payload.value, requestEducationScope(request)));
}
