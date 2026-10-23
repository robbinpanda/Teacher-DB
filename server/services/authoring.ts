import { randomUUID } from "node:crypto";
import { getSqlite } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import type { EducationScope } from "../../lib/education-scope";
import { authoringPlanSystemPrompt, validateAuthoringPlan, validateAuthoringRequest, planSummary, type AuthoringRequest, type AuthoringPlan } from "../../lib/authoring-plan";
import { knowledgeCatalog, curriculumSource } from "../../lib/knowledge-catalog";
import { parseModelJson } from "../../lib/question-classification";
import { loadRetrievalRows, rankQuestions } from "../../lib/knowledge-retrieval";
import { callTextModel } from "../../lib/text-model";
import { resolveModelProfile } from "../../lib/model-profiles";
import { getPaperData, getUploadedPaperData } from "../../lib/question-repository";

async function variationSource(ownerId: string, scope: EducationScope, request: AuthoringRequest) {
  if (request.kind !== "variation") return null;
  const source = request.sourcePaperKind === "uploaded" ? await getUploadedPaperData(request.sourcePaperId!, ownerId) : await getPaperData(request.sourcePaperId!, ownerId);
  if (!source?.questions.length) throw new Error("原卷不存在或没有题目");
  const permitted = loadRetrievalRows(getSqlite(), ownerId, scope, undefined, source.questions.map(question => question.id));
  if (permitted.length !== source.questions.length) throw new Error("原卷包含未审核或其他学科学段的题目");
  return { id: source.id, title: source.title, questions: source.questions.map(question => ({ id: question.id, number: question.number, type: question.type, stem: question.stem, tags: question.tags })) };
}

type ProjectRow = { id: string; owner_id: string; subject: string; stage: EducationScope["stage"]; kind: AuthoringRequest["kind"]; title: string; request_json: string; plan_json: string | null; status: string; revision: number; error: string | null; created_at: string; updated_at: string };
export function readAuthoringProject(ownerId: string, scope: EducationScope, id: string) {
  const sqlite = getSqlite();
  const row = sqlite.prepare("SELECT * FROM authoring_projects WHERE id=? AND owner_id=? AND subject=? AND stage=?").get(id, ownerId, scope.subject, scope.stage) as ProjectRow | undefined;
  if (!row) return null;
  const plan = row.plan_json ? JSON.parse(row.plan_json) as AuthoringPlan : null;
  return { id: row.id, title: row.title, kind: row.kind, status: row.status, revision: row.revision, error: row.error,
    createdAt: row.created_at, updatedAt: row.updated_at, request: JSON.parse(row.request_json) as AuthoringRequest, plan, summary: plan ? planSummary(plan) : null };
}
export async function createAuthoringProject(ownerId: string, scope: EducationScope, value: unknown) {
  await ensureDatabase();
  const request = validateAuthoringRequest(value, scope);
  await variationSource(ownerId, scope, request);
  // Resolve before enqueueing, so missing or another teacher's model fails visibly.
  const profile = await resolveModelProfile(ownerId, request.profileId);
  request.profileId = profile.id;
  const sqlite = getSqlite();
  if (request.documentIds.length) {
    const rows = loadRetrievalRows(sqlite, ownerId, scope, request.documentIds);
    const found = new Set(rows.map(row => row.documentId));
    if (request.documentIds.some(id => !found.has(id))) throw new Error("选定资料没有当前范围内的已审核题目，请先完成入库");
  }
  const id = randomUUID(), time = new Date().toISOString();
  sqlite.prepare(`INSERT INTO authoring_projects(id,owner_id,subject,stage,kind,title,request_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'queued',?,?)`).run(id, ownerId, scope.subject, scope.stage, request.kind, request.instruction.slice(0, 60), JSON.stringify(request), time, time);
  return readAuthoringProject(ownerId, scope, id)!;
}

export function saveAuthoringPlan(ownerId: string, scope: EducationScope, id: string, revision: number, value: unknown) {
  const sqlite = getSqlite();
  return sqlite.transaction(() => {
    const project = readAuthoringProject(ownerId, scope, id);
    if (!project) throw new Error("作品不存在");
    if (project.revision !== revision || project.status !== "planned") throw new Error("作品已变化或正在生成，请刷新后再保存");
    const plan = validateAuthoringPlan(value, scope, project.request);
    sqlite.prepare("UPDATE authoring_projects SET title=?,plan_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=?")
      .run(plan.title, JSON.stringify(plan), new Date().toISOString(), id, ownerId);
    return readAuthoringProject(ownerId, scope, id)!;
  })();
}

export function inspectAuthoringCoverage(ownerId: string, scope: EducationScope, id: string) {
  const project = readAuthoringProject(ownerId, scope, id);
  if (!project?.plan) throw new Error("作品还没有可检查的大纲");
  const rows = loadRetrievalRows(getSqlite(), ownerId, scope, project.request.documentIds.length ? project.request.documentIds : undefined);
  const cached = new Map<string, ReturnType<typeof rankQuestions>>();
  return project.plan.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, slots: chapter.slots.map(slot => {
    const key = JSON.stringify([slot.knowledgeIds.slice().sort(), slot.type]);
    const result = cached.get(key) ?? rankQuestions(rows, scope, { knowledgeIds: slot.knowledgeIds, match: "all", types: slot.type === "any" ? undefined : [slot.type], limit: 100 });
    cached.set(key, result);
    const counts = result.difficultyCounts.find(count => count.difficulty === slot.difficulty)!;
    return { ...slot, candidateCount: result.total, difficultyMatchedCount: counts.classified, confirmedCount: counts.confirmed,
      shortage: Math.max(0, slot.count - counts.confirmed), candidates: result.hits.slice(0, 12) };
  }) }));
}

/** One durable plan at a time. A crashed process is recovered only after its lease expires. */
export async function kickAuthoringPlanning() {
  await ensureDatabase();
  const sqlite = getSqlite(), token = randomUUID(), now = new Date().toISOString();
  const job = sqlite.transaction(() => {
    const candidate = sqlite.prepare(`SELECT * FROM authoring_projects WHERE status='queued' OR (status='planning' AND lease_expires_at < ?) ORDER BY created_at LIMIT 1`).get(now) as ProjectRow | undefined;
    if (!candidate) return undefined;
    sqlite.prepare("UPDATE authoring_projects SET status='planning',lease_owner=?,lease_expires_at=?,error=NULL,updated_at=? WHERE id=?")
      .run(token, new Date(Date.now() + 10 * 60_000).toISOString(), now, candidate.id);
    return candidate;
  })();
  if (!job) return;
  const scope = { subject: job.subject, stage: job.stage }, request = JSON.parse(job.request_json) as AuthoringRequest;
  try {
    const inventory = loadRetrievalRows(sqlite, job.owner_id, scope, request.documentIds.length ? request.documentIds : undefined);
    const counts = inventory.reduce((result, question) => { result[question.type] = (result[question.type] ?? 0) + 1; return result; }, {} as Record<string, number>);
    const sourcePaper = await variationSource(job.owner_id, scope, request);
    const result = await callTextModel({ ownerId: job.owner_id, profileId: request.profileId, system: authoringPlanSystemPrompt,
      text: JSON.stringify({ scope, request, sourcePaper, catalog: knowledgeCatalog(scope.subject, scope.stage), reference: scope.subject === "数学" && scope.stage === "high" ? curriculumSource : null, availableQuestionCounts: counts }),
      purpose: "authoring_plan", jsonMode: true, maxOutputTokens: 14000, timeoutMs: 240000 });
    const plan = validateAuthoringPlan(parseModelJson(result.content), scope, request);
    sqlite.prepare(`UPDATE authoring_projects SET title=?,plan_json=?,status='planned',revision=revision+1,error=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='planning'`)
      .run(plan.title, JSON.stringify(plan), new Date().toISOString(), job.id, token);
  } catch (error) {
    sqlite.prepare("UPDATE authoring_projects SET status='failed',error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='planning'")
      .run(error instanceof Error ? error.message.slice(0, 1500) : "大纲生成失败", new Date().toISOString(), job.id, token);
  }
}
