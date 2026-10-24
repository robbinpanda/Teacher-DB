import { prepareWholePaperSource } from "./authoring-variation-source";
import type { WholePaperSource, WholePaperVariation, WholePaperVariationItem } from "../../lib/authoring-variation";
import { randomUUID } from "node:crypto";
import { getSqlite } from "../../db";
import { selectionProgressFromJson } from "../../lib/authoring-candidates";
import { ensureDatabase } from "../../db/bootstrap";
import type { EducationScope } from "../../lib/education-scope";
import { authoringPlanSystemPrompt, validateAuthoringPlan, validateAuthoringRequest, planSummary, assumedPrerequisites, type AuthoringRequest, type AuthoringPlan } from "../../lib/authoring-plan";
import { knowledgeCatalog, curriculumSource, expandKnowledgeIds } from "../../lib/knowledge-catalog";
import { loadRetrievalRows, matchQuestions, fingerprintRow } from "../../lib/knowledge-retrieval";
import { authoringModel } from "./authoring-model";
import { allocateUniqueQuestions, inspectWorkCoverage } from "../../lib/authoring-coverage";
import { questionIdentityKey } from "../../lib/question-identity";
import { resolveModelProfile } from "../../lib/model-profiles";
import { getPaperData, getUploadedPaperData } from "../../lib/question-repository";
import type { AuthoringChapter, SavedChapterContent } from "../../lib/authoring-content";
import { authoringRequirementsSystemPrompt, parseAuthoringRequirements, inspectPlanRequirements, type AuthoringRequirements } from "../../lib/authoring-requirements";

async function variationSource(ownerId: string, scope: EducationScope, request: AuthoringRequest) {
  if (request.kind !== "variation") return null;
  const source = request.sourcePaperKind === "uploaded" ? await getUploadedPaperData(request.sourcePaperId!, ownerId) : await getPaperData(request.sourcePaperId!, ownerId);
  if (!source?.questions.length) throw new Error("原卷不存在或没有题目");
  const permitted = loadRetrievalRows(getSqlite(), ownerId, scope, undefined, source.questions.map(question => question.id));
  if (permitted.length !== source.questions.length) throw new Error("原卷包含未审核或其他学科学段的题目");
  return { id: source.id, title: source.title, questions: source.questions.map(question => ({ id: question.id, number: question.number, type: question.type, stem: question.stem, tags: question.tags })) };
}

type ProjectRow = { id: string; owner_id: string; subject: string; stage: EducationScope["stage"]; kind: AuthoringRequest["kind"]; title: string; request_json: string; plan_json: string | null; requirements_json: string | null; status: string; revision: number; error: string | null; created_at: string; updated_at: string; paper_id: string | null };
export function readAuthoringProject(ownerId: string, scope: EducationScope, id: string) {
  const sqlite = getSqlite();
  const row = sqlite.prepare("SELECT * FROM authoring_projects WHERE id=? AND owner_id=? AND subject=? AND stage=?").get(id, ownerId, scope.subject, scope.stage) as ProjectRow | undefined;
  if (!row) return null;
  const plan = row.plan_json ? JSON.parse(row.plan_json) as AuthoringPlan : null;
  const requirements = row.requirements_json ? JSON.parse(row.requirements_json) as AuthoringRequirements : null;
  const chapters = (sqlite.prepare("SELECT c.*,s.state_json AS selection_state,s.updated_at AS selection_updated FROM authoring_chapters c LEFT JOIN authoring_selection_checkpoints s ON s.chapter_id=c.id WHERE c.project_id=? ORDER BY c.position").all(id) as Array<{ id: string; position: number; plan_json: string; content_json: string | null; status: AuthoringChapter["status"]; revision: number; attempt: number; error: string | null;selection_state:string|null;selection_updated:string|null }>).map(chapter => ({
    id: chapter.id, position: chapter.position, plan: JSON.parse(chapter.plan_json), content: chapter.content_json ? JSON.parse(chapter.content_json) as SavedChapterContent : null,
    history: (sqlite.prepare("SELECT id,revision,reason,created_at AS createdAt,plan_json IS NOT NULL AS hasPlan,content_json != 'null' AS hasContent FROM authoring_chapter_versions WHERE chapter_id=? ORDER BY revision DESC").all(chapter.id) as Array<{ id: string; revision: number; reason: string; createdAt: string; hasPlan: number; hasContent: number }>).map(version => ({ ...version, hasPlan: Boolean(version.hasPlan), hasContent: Boolean(version.hasContent) })),
    status: chapter.status, revision: chapter.revision, attempt: chapter.attempt, error: chapter.error,
    selectionProgress: selectionProgressFromJson(chapter.selection_state,chapter.selection_updated),
  })) as AuthoringChapter[];
  const sourceSnapshot = sqlite.prepare("SELECT snapshot_json FROM authoring_variation_sources WHERE project_id=?").get(id) as { snapshot_json: string } | undefined;
  const variation: WholePaperVariation | null = sourceSnapshot ? { sourceTitle: (JSON.parse(sourceSnapshot.snapshot_json) as WholePaperSource).title,
    items: (sqlite.prepare(`SELECT i.*,vc.id AS candidate_id,vc.content_json AS candidate_json,vc.review_json FROM authoring_variation_items i
      LEFT JOIN variation_candidates vc ON vc.run_id=i.run_id AND vc.ordinal=1 WHERE i.project_id=? ORDER BY i.position`).all(id) as Array<Record<string, unknown>>).map(item => {
      const saved = JSON.parse(item.source_json as string) as WholePaperSource["items"][number];
      return { id: item.id, position: item.position, source: saved.source, number: saved.number, score: saved.score, sectionTitle: saved.sectionTitle,
        status: item.status, revision: item.revision, attempt: item.attempt, stage: item.stage, error: item.error, runId: item.run_id, promotedQuestionId: item.promoted_question_id,
        candidate: item.candidate_json ? { id: item.candidate_id, question: JSON.parse(item.candidate_json as string), review: JSON.parse(item.review_json as string) } : null } as WholePaperVariationItem;
    }) } : null;
  const request = JSON.parse(row.request_json) as AuthoringRequest;
  const selectedIds = [...new Set(chapters.flatMap(chapter => chapter.content?.items.map(item => item.questionId) ?? []))];
  const sources = new Map(loadRetrievalRows(sqlite, ownerId, scope, request.documentIds.length ? request.documentIds : undefined, selectedIds).map(question => [question.id, { fingerprint: fingerprintRow(question, scope), type: question.type }]));
  const stale = [...new Set(chapters.flatMap(chapter => chapter.content?.items.filter(item => {
    const source = sources.get(item.questionId);
    return !source || source.fingerprint !== chapter.content!.questionFingerprints[item.questionId] || source.type !== chapter.content!.questions.find(question => question.id === item.questionId)?.type;
  }).map(item => item.questionId) ?? []))];
  return { variation, id: row.id, title: row.title, subject: row.subject, stage: row.stage, kind: row.kind, status: row.status, revision: row.revision, error: row.error,
    createdAt: row.created_at, updatedAt: row.updated_at, request, plan, requirements, requirementChecks: plan && requirements ? inspectPlanRequirements(plan, requirements, scope) : [], chapters, paperId: row.paper_id, summary: plan ? planSummary(plan) : null,
    assumedPrerequisites: plan ? assumedPrerequisites(plan, scope) : [], workCoverage: plan ? inspectWorkCoverage(plan, request, chapters, scope, stale) : null };
}
export async function createAuthoringProject(ownerId: string, scope: EducationScope, value: unknown) {
  await ensureDatabase();
  const request = validateAuthoringRequest(value, scope);
  const wholePaper = request.kind === "variation" ? await prepareWholePaperSource(ownerId, scope, request) : null;
  // Resolve before enqueueing, so missing or another teacher's model fails visibly.
  const profile = await resolveModelProfile(ownerId, request.profileId);
  request.profileId = profile.id;
  if (wholePaper || request.reviewerProfileId) request.reviewerProfileId = (await resolveModelProfile(ownerId, request.reviewerProfileId ?? profile.id)).id;
  const sqlite = getSqlite();
  if (request.documentIds.length) {
    const rows = loadRetrievalRows(sqlite, ownerId, scope, request.documentIds);
    const found = new Set(rows.map(row => row.documentId));
    if (request.documentIds.some(id => !found.has(id))) throw new Error("选定资料没有当前范围内的已审核题目，请先完成入库");
  }
  const id = randomUUID(), time = new Date().toISOString();
  sqlite.transaction(() => {
  sqlite.prepare(`INSERT INTO authoring_projects(id,owner_id,subject,stage,kind,title,request_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, ownerId, scope.subject, scope.stage, request.kind, wholePaper ? `${wholePaper.title} · 变式卷` : request.instruction.slice(0, 60), JSON.stringify(request), wholePaper ? "planned" : "queued", time, time);
  if (wholePaper) {
    sqlite.prepare("INSERT INTO authoring_variation_sources(project_id,snapshot_json) VALUES(?,?)").run(id, JSON.stringify(wholePaper));
    const insert = sqlite.prepare("INSERT INTO authoring_variation_items(id,project_id,position,source_json,updated_at) VALUES(?,?,?,?,?)");
    wholePaper.items.forEach((item, position) => insert.run(randomUUID(), id, position, JSON.stringify(item), time));
  }
  }).immediate();
  return readAuthoringProject(ownerId, scope, id)!;
}

export function saveAuthoringPlan(ownerId: string, scope: EducationScope, id: string, revision: number, value: unknown, requirementsValue?: unknown) {
  const sqlite = getSqlite();
  return sqlite.transaction(() => {
    const project = readAuthoringProject(ownerId, scope, id);
    if (!project) throw new Error("作品不存在");
    if (project.revision !== revision || !["planned", "failed"].includes(project.status) || project.chapters.length || project.kind === "variation") throw new Error("作品已变化或正在生成，请刷新后再保存");
    if (value === undefined && requirementsValue === undefined) throw new Error("没有要保存的大纲或要求");
    const requirements = requirementsValue === undefined ? project.requirements : parseAuthoringRequirements(requirementsValue, scope, project.request.instruction, true);
    const candidate = value === undefined ? project.plan : value;
    const plan = candidate ? validateAuthoringPlan(candidate, scope, project.request, requirements) : null;
    if (project.plan && !plan) throw new Error("不能清空已保存的大纲");
    sqlite.prepare("UPDATE authoring_projects SET title=?,plan_json=?,requirements_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=?")
      .run(plan?.title ?? project.title, plan ? JSON.stringify(plan) : null, requirements ? JSON.stringify(requirements) : null, new Date().toISOString(), id, ownerId);
    return readAuthoringProject(ownerId, scope, id)!;
  }).immediate();
}

export async function changeAuthoringModels(ownerId: string, scope: EducationScope, id: string, revision: number, profileId: string, reviewerProfileId?: string) {
  const assertEditable = (project: ReturnType<typeof readAuthoringProject>) => {
    if (!project) throw new Error("作品不存在");
    if (project.kind === "variation") throw new Error("整卷变式的模型随逐题任务保存，请创建新版本选择模型");
    if (project.revision !== revision) throw new Error("作品已变化，请刷新后修改模型");
    if (["queued", "planning", "generating"].includes(project.status) || project.chapters.some(chapter => chapter.status === "running")) throw new Error("请先暂停并等待当前任务结束，再修改本作品模型");
    return project;
  };
  assertEditable(readAuthoringProject(ownerId, scope, id));
  const writer = await resolveModelProfile(ownerId, profileId);
  const reviewer = reviewerProfileId ? await resolveModelProfile(ownerId, reviewerProfileId) : null;
  return getSqlite().transaction(() => {
    const project = assertEditable(readAuthoringProject(ownerId, scope, id));
    const request = { ...project.request, profileId: writer.id, reviewerProfileId: reviewer?.id };
    getSqlite().prepare("UPDATE authoring_projects SET request_json=?,revision=revision+1,updated_at=? WHERE id=?")
      .run(JSON.stringify(request), new Date().toISOString(), id);
    return readAuthoringProject(ownerId, scope, id)!;
  }).immediate();
}

export function inspectAuthoringCoverage(ownerId: string, scope: EducationScope, id: string) {
  const project = readAuthoringProject(ownerId, scope, id);
  if (!project?.plan) throw new Error("作品还没有可检查的大纲");
  const rows = loadRetrievalRows(getSqlite(), ownerId, scope, project.request.documentIds.length ? project.request.documentIds : undefined);
  const identities = new Map(rows.map(row => [row.id, questionIdentityKey(row)]));
  const cached = new Map<string, ReturnType<typeof matchQuestions>>(), catalog = knowledgeCatalog(scope.subject, scope.stage);
  const matching = project.plan.chapters.flatMap(chapter => chapter.slots.map(slot => {
    const key = JSON.stringify([slot.knowledgeIds.slice().sort(), slot.type]);
    const result = cached.get(key) ?? matchQuestions(rows, scope, { knowledgeIds: slot.knowledgeIds, match: "all", types: slot.type === "any" ? undefined : [slot.type] });
    cached.set(key, result);
    const counts = result.difficultyCounts.find(count => count.difficulty === slot.difficulty)!;
    const eligible = result.hits.filter(hit => !hit.structureIssues?.some(issue=>issue.severity==='error') && hit.classification?.difficulty === slot.difficulty && slot.knowledgeIds.every(id => expandKnowledgeIds([id], catalog).some(id => hit.matchedKnowledgeIds.includes(id))));
    return { slot, result, counts, eligible };
  }));
  const allocate = (confirmed: boolean) => allocateUniqueQuestions(matching.map(({ slot, eligible }) => ({ count: slot.count,
    candidates: eligible.filter(hit => !confirmed || hit.classificationStatus === "confirmed").map(hit => ({ id: hit.id, key: identities.get(hit.id)! })) })));
  const confirmed = allocate(true), classified = allocate(false); let index = 0;
  return project.plan.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, slots: chapter.slots.map(() => {
    const at = index++, { slot, result, counts } = matching[at];
    return { ...slot, candidateCount: result.total, structureBlockedCount: result.hits.filter(hit=>hit.structureIssues?.some(issue=>issue.severity==='error')).length, difficultyMatchedCount: counts.classified, confirmedCount: counts.confirmed,
      allocatedConfirmedCount: confirmed[at].length, allocatedClassifiedCount: classified[at].length,
      shortage: Math.max(0, slot.count - confirmed[at].length), taggedShortage: Math.max(0, slot.count - classified[at].length), candidates: result.hits.slice(0, 12) };
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
  }).immediate();
  if (!job) return;
  const scope = { subject: job.subject, stage: job.stage }, request = JSON.parse(job.request_json) as AuthoringRequest;
  const heartbeat = setInterval(() => {
    sqlite.prepare("UPDATE authoring_projects SET lease_expires_at=? WHERE id=? AND lease_owner=? AND status='planning'")
      .run(new Date(Date.now() + 10 * 60_000).toISOString(), job.id, token);
  }, 30_000);
  heartbeat.unref();
  try {
    let requirements = job.requirements_json ? JSON.parse(job.requirements_json) as AuthoringRequirements : null;
    if (!requirements) {
      const extracted = await authoringModel({ ownerId: job.owner_id, profileId: request.profileId, system: authoringRequirementsSystemPrompt,
        text: JSON.stringify({ instruction: request.instruction, scope, catalog: knowledgeCatalog(scope.subject, scope.stage) }),
        purpose: "authoring_requirements", jsonMode: true, maxOutputTokens: 7000, timeoutMs: 240000 }, value => parseAuthoringRequirements(value, scope, request.instruction));
      requirements = extracted.value;
      const saved = sqlite.prepare("UPDATE authoring_projects SET requirements_json=?,revision=revision+1,updated_at=? WHERE id=? AND lease_owner=? AND status='planning'")
        .run(JSON.stringify(requirements), new Date().toISOString(), job.id, token);
      if (!saved.changes) return;
    }
    if (requirements.questions.length) throw new Error(`请先核对教学要求：${requirements.questions.map(item => item.question).join("；")}`);
    const inventory = loadRetrievalRows(sqlite, job.owner_id, scope, request.documentIds.length ? request.documentIds : undefined);
    const counts = inventory.reduce((result, question) => { result[question.type] = (result[question.type] ?? 0) + 1; return result; }, {} as Record<string, number>);
    const sourcePaper = await variationSource(job.owner_id, scope, request);
    const result = await authoringModel({ ownerId: job.owner_id, profileId: request.profileId, system: authoringPlanSystemPrompt,
      text: JSON.stringify({ scope, request, requirements, sourcePaper, catalog: knowledgeCatalog(scope.subject, scope.stage), reference: scope.subject === "数学" && scope.stage === "high" ? curriculumSource : null, availableQuestionCounts: counts }),
      purpose: "authoring_plan", jsonMode: true, maxOutputTokens: 14000, timeoutMs: 240000 }, value => validateAuthoringPlan(value, scope, request, requirements));
    const plan = result.value;
    sqlite.prepare(`UPDATE authoring_projects SET title=?,plan_json=?,status='planned',revision=revision+1,error=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='planning'`)
      .run(plan.title, JSON.stringify(plan), new Date().toISOString(), job.id, token);
  } catch (error) {
    sqlite.prepare("UPDATE authoring_projects SET status='failed',error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='planning'")
      .run(error instanceof Error ? error.message.slice(0, 1500) : "大纲生成失败", new Date().toISOString(), job.id, token);
  } finally { clearInterval(heartbeat); }
}
