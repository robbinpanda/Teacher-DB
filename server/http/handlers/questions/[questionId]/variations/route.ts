import { requestOwner } from "../../../../../../lib/server";
import { generateVariationCandidates } from "../../../../../services/variation-candidates";
export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  return generateVariationCandidates(requestOwner(request), (await context.params).questionId, await request.json().catch(() => ({})));
}
