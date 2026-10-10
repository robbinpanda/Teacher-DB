import { uploadDocumentPage } from "../../../../../services/document-pages";
import { toResponse } from "../../../../../core/result";
import { readFormDataPayload } from "../../../../../../lib/request-payload";
import { requestOwner } from "../../../../../../lib/server";


export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const payload = await readFormDataPayload(request);
  if (!payload.ok) return payload.response;
  const { documentId } = await context.params;
  return toResponse(await uploadDocumentPage(requestOwner(request), documentId, payload.value));
}
