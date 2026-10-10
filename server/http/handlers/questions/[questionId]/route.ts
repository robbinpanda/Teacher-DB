import { saveQuestion } from "../../../../services/question-review";
import { toResponse } from "../../../../core/result";
import { readJsonPayload } from "../../../../../lib/request-payload";
import { requestOwner } from "../../../../../lib/server";


export async function PUT(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const payload = await readJsonPayload<Record<string, unknown>>(request);
  if (!payload.ok) return payload.response;
  const { questionId } = await context.params;
  return toResponse(await saveQuestion(requestOwner(request), questionId, payload.value));
}
