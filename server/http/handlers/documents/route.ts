import { uploadDocument } from "../../../services/document-upload";
import { getDocuments } from "../../../../lib/question-repository";
import { toResponse } from "../../../core/result";
import { readFormDataPayload } from "../../../../lib/request-payload";
import { requestOwner } from "../../../../lib/server";


export async function GET(request: Request) {
  return Response.json({ documents: await getDocuments(requestOwner(request)) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const payload = await readFormDataPayload(request);
  if (!payload.ok) return payload.response;
  return toResponse(await uploadDocument(requestOwner(request), payload.value));
}
