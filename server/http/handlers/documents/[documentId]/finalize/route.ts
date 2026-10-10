import { finalizeDocument } from "../../../../../services/document-finalize";
import { toResponse } from "../../../../../core/result";
import { requestOwner } from "../../../../../../lib/server";


export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  return toResponse(await finalizeDocument(requestOwner(request), documentId, request.headers.get("x-extraction-worker-id")?.trim() || null));
}
