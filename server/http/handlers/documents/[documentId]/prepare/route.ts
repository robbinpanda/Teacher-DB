import { z } from "zod";
import { requestOwner } from "../../../../../../lib/server";
import { enqueueDocumentPreparation } from "../../../../../services/document-preparation";
import { result, toResponse } from "../../../../../core/result";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const payload = z.object({ profileId: z.string().min(1).max(100).optional() }).strict().safeParse(await request.json().catch(() => null));
  if (!payload.success) return toResponse(result({ error: "分页请求格式无效" }, { status: 400 }));
  return toResponse(await enqueueDocumentPreparation(requestOwner(request), (await context.params).documentId, payload.data.profileId));
}
