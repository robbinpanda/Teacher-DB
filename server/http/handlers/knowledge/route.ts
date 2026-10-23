import { z } from "zod";
import { getSqlite } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { requestOwner } from "../../../../lib/server";
import { requestEducationScope } from "../../../../lib/education-scope";
import { knowledgeCatalog, knowledgeCatalogVersion, curriculumSource, questionMethods, questionCompetencies } from "../../../../lib/knowledge-catalog";
import { loadRetrievalRows, rankQuestions } from "../../../../lib/knowledge-retrieval";

const searchSchema = z.object({
  query: z.string().max(300).optional(), knowledgeIds: z.array(z.string().max(150)).max(30).optional(),
  documentIds: z.array(z.string().min(1).max(100)).max(100).optional(), types: z.array(z.enum(["single","multiple","fill","answer"])).max(4).optional(),
  difficulty: z.number().int().min(1).max(5).optional(), confirmedOnly: z.boolean().optional(), match: z.enum(["any","all"]).optional(),
  excludeIds: z.array(z.string().max(100)).max(1000).optional(), limit: z.number().int().min(1).max(100).optional(),
  methods: z.array(z.enum(questionMethods)).max(6).optional(), competencies: z.array(z.enum(questionCompetencies)).max(5).optional(),
  offset: z.number().int().min(0).max(1000000).optional(),
});
export async function GET(request: Request) {
  const scope = requestEducationScope(request);
  return Response.json({ scope, version: knowledgeCatalogVersion, nodes: knowledgeCatalog(scope.subject, scope.stage), source: scope.subject === "数学" && scope.stage === "high" ? curriculumSource : null });
}
export async function POST(request: Request) {
  await ensureDatabase();
  const parsed = searchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "检索条件格式无效" }, { status: 400 });
  const scope = requestEducationScope(request);
  try {
    return Response.json(rankQuestions(loadRetrievalRows(getSqlite(), requestOwner(request), scope, parsed.data.documentIds), scope, parsed.data));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "检索失败" }, { status: 400 }); }
}
