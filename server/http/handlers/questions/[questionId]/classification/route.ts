import { z } from "zod";
import { getSqlite } from "../../../../../../db";
import { ensureDatabase } from "../../../../../../db/bootstrap";
import { requestOwner } from "../../../../../../lib/server";
import { requestEducationScope } from "../../../../../../lib/education-scope";
import { fingerprintRow, loadRetrievalRows, rankQuestions } from "../../../../../../lib/knowledge-retrieval";
import { classifyQuestion, saveClassification } from "../../../../../services/question-classification";
import { getApprovedQuestions } from "../../../../../../lib/question-repository";

type Context = { params: Promise<{ questionId: string }> };
export async function GET(request: Request, context: Context) {
  await ensureDatabase();
  const scope = requestEducationScope(request), { questionId } = await context.params;
  const rows = loadRetrievalRows(getSqlite(), requestOwner(request), scope, undefined, [questionId]);
  if (!rows.length) return Response.json({ error: "题目不存在" }, { status: 404 });
  return Response.json({ ...rankQuestions(rows, scope).hits[0], fingerprint: fingerprintRow(rows[0], scope), question: (await getApprovedQuestions(requestOwner(request), [questionId], scope))[0] });
}
export async function POST(request: Request, context: Context) {
  const parsed = z.object({ profileId: z.string().max(100).optional() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "标注请求格式无效" }, { status: 400 });
  try { return Response.json(await classifyQuestion(requestOwner(request), requestEducationScope(request), (await context.params).questionId, parsed.data.profileId)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "模型标注失败" }, { status: 400 }); }
}
export async function PATCH(request: Request, context: Context) {
  await ensureDatabase();
  const parsed = z.object({ fingerprint: z.string().length(64), classification: z.unknown() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "确认请求格式无效" }, { status: 400 });
  try { return Response.json({ classification: saveClassification(requestOwner(request), requestEducationScope(request), (await context.params).questionId,
    parsed.data.fingerprint, parsed.data.classification, "confirmed"), status: "confirmed" }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "确认失败" }, { status: 409 }); }
}
