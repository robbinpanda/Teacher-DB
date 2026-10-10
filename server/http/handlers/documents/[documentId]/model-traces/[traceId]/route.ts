import { documentModelTraces } from "../../../../../../services/model-traces";
import { requestOwner } from "../../../../../../../lib/server";

export async function GET(request: Request, context: { params: Promise<{ documentId: string; traceId: string }> }) {
  const { documentId, traceId } = await context.params;
  return documentModelTraces(request, requestOwner(request), documentId, traceId);
}
