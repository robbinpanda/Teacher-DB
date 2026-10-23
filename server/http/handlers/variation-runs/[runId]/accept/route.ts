import { requestOwner } from "../../../../../../lib/server";
import { acceptVariationCandidates } from "../../../../../services/variation-acceptance";
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  return acceptVariationCandidates(requestOwner(request), (await context.params).runId, await request.json().catch(() => ({})));
}
