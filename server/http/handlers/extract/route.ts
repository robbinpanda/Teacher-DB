import { extractDocument, type ExtractionInput } from "../../../services/extraction";
import { toResponse } from "../../../core/result";
import { readJsonPayload } from "../../../../lib/request-payload";
import { requestOwner } from "../../../../lib/server";


export async function POST(request: Request) {
  const payload = await readJsonPayload<ExtractionInput>(request);
  if (!payload.ok) return payload.response;
  return toResponse(await extractDocument(requestOwner(request), payload.value));
}
