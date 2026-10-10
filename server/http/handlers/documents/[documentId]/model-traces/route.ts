import { documentModelTraces } from "../../../../../services/model-traces";
import { requestOwner } from "../../../../../../lib/server";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  return documentModelTraces(request, requestOwner(request), documentId);
}
