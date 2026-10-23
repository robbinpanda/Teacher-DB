import { randomUUID } from "node:crypto";
import { getSqlite } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import type { EducationScope } from "../../lib/education-scope";
import type { WholePaperSource } from "../../lib/authoring-variation";
import { getApprovedQuestions } from "../../lib/question-repository";
import { readAuthoringProject } from "./authoring";
import { prepareWholePaperSource } from "./authoring-variation-source";
import { generateVariationCandidates, getVariationRun } from "./variation-candidates";
import { acceptVariationCandidates } from "./variation-acceptance";

const time = () => new Date().toISOString();
const lease = () => new Date(Date.now() + 180_000).toISOString();
function requireProject(owner: string, scope: EducationScope, id: string) {
  const project = readAuthoringProject(owner, scope, id);
  if (!project?.variation || project.kind !== "variation") throw new Error("整卷变式作品不存在");
  return project;
}
async function freshSource(owner: string, scope: EducationScope, id: string) {
  const project = requireProject(owner, scope, id);
  const row = getSqlite().prepare("SELECT snapshot_json FROM authoring_variation_sources WHERE project_id=?").get(id) as {snapshot_json:string};
  const snapshot = JSON.parse(row.snapshot_json) as WholePaperSource;
  const current = await prepareWholePaperSource(owner, scope, project.request);
  if (current.fingerprint !== snapshot.fingerprint) throw new Error("原卷题目、顺序或分值已变化，请以更新后的原卷重新创建变式作品");
  return snapshot;
}
function progress(id: string) {
  const db = getSqlite();
  const rows = db.prepare("SELECT status FROM authoring_variation_items WHERE project_id=?").all(id) as Array<{status:string}>;
  const status = rows.every(row => row.status === "accepted") ? "completed" : rows.some(row => ["pending", "running", "accepting"].includes(row.status)) ? "generating" : "reviewing";
  db.prepare("UPDATE authoring_projects SET status=CASE WHEN status='paused' THEN status ELSE ? END,revision=revision+1,updated_at=? WHERE id=?").run(status, time(), id);
}
export async function controlWholePaperVariation(owner: string, scope: EducationScope, id: string, revision: number, action: "generate"|"pause"|"resume") {
  if (action !== "pause") await freshSource(owner, scope, id);
  return getSqlite().transaction(() => {
    const project = requireProject(owner, scope, id);
    const expected = action === "generate" ? "planned" : action === "pause" ? "generating" : "paused";
    if (project.revision !== revision || project.status !== expected) throw new Error("作品已变化，请刷新后重试");
    getSqlite().prepare("UPDATE authoring_projects SET status=?,revision=revision+1,error=NULL,updated_at=? WHERE id=?").run(action === "pause" ? "paused" : "generating", time(), id);
    if (action === "resume") progress(id);
    return requireProject(owner, scope, id);
  })();
}
export async function retryWholePaperItem(owner: string, scope: EducationScope, projectId: string, itemId: string, revision: number) {
  await freshSource(owner, scope, projectId);
  return getSqlite().transaction(() => {
    const project = requireProject(owner, scope, projectId), item = project.variation!.items.find(row => row.id === itemId);
    if (!item || item.revision !== revision || !["failed", "awaiting_teacher", "accepted"].includes(item.status)) throw new Error("题目已变化或正在处理，请刷新后重试");
    getSqlite().prepare("UPDATE authoring_variation_items SET status='pending',run_id=NULL,promoted_question_id=NULL,error=NULL,stage=NULL,revision=revision+1,updated_at=? WHERE id=?").run(time(), itemId);
    getSqlite().prepare("UPDATE authoring_projects SET paper_id=NULL WHERE id=?").run(projectId);
    progress(projectId);
    return requireProject(owner, scope, projectId);
  })();
}

/** Only an explicit teacher action creates an accepting job. Recovery may finish that same adoption. */
export async function acceptWholePaperItem(owner: string, scope: EducationScope, projectId: string, itemId: string, revision: number) {
  await freshSource(owner, scope, projectId);
  const db = getSqlite(), token = randomUUID();
  db.transaction(() => {
    const project = requireProject(owner, scope, projectId), item = project.variation!.items.find(row => row.id === itemId);
    if (!item || item.revision !== revision || item.status !== "awaiting_teacher" || !item.candidate || !item.runId) throw new Error("题目已变化或尚无可采用的候选，请刷新后重试");
    db.prepare("UPDATE authoring_variation_items SET status='accepting',revision=revision+1,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=?").run(token, lease(), time(), itemId);
  })();
  await finishAcceptance(owner, scope, projectId, itemId, token);
  return requireProject(owner, scope, projectId);
}

async function finishAcceptance(owner: string, scope: EducationScope, projectId: string, itemId: string, token: string) {
  const db = getSqlite();
  try {
    await freshSource(owner, scope, projectId);
    const item = requireProject(owner, scope, projectId).variation!.items.find(row => row.id === itemId)!;
    if (!item.runId || !item.candidate) throw new Error("候选记录丢失，请重新生成");
    let run = await getVariationRun(owner, item.runId);
    if (run?.status !== "complete") {
      const response = await acceptVariationCandidates(owner, item.runId, { candidateIds: [item.candidate.id] });
      if (!response.ok) throw new Error((await response.json()).error ?? "候选题采用失败");
      run = await getVariationRun(owner, item.runId);
    }
    const candidate = run?.candidates.find(row => row.id === item.candidate!.id);
    if (!candidate?.promotedQuestionId) throw new Error("采用记录尚未完成，请重试");
    const [question] = await getApprovedQuestions(owner, [candidate.promotedQuestionId], scope);
    if (!question || question.parentQuestionId !== item.source.id || question.type !== item.source.type || question.needsHumanReview) throw new Error("采用后的题目状态或来源不一致");
    db.transaction(() => {
      const changed = db.prepare("UPDATE authoring_variation_items SET status='accepted',promoted_question_id=?,stage=NULL,error=NULL,lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND lease_owner=? AND status='accepting'")
        .run(question.id, time(), itemId, token);
      if (changed.changes) progress(projectId);
    })();
  } catch (error) {
    const changed = db.prepare("UPDATE authoring_variation_items SET status='awaiting_teacher',error=?,lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND lease_owner=? AND status='accepting'")
      .run(error instanceof Error ? error.message : "采用失败", time(), itemId, token);
    if (changed.changes) progress(projectId);
    throw error;
  }
}

export async function kickWholePaperVariations() {
  await ensureDatabase();
  const db = getSqlite(), token = randomUUID(), now = time();
  const job = db.transaction(() => {
    const row = db.prepare(`SELECT i.id,i.project_id,i.status,i.run_id,i.attempt,p.owner_id,p.subject,p.stage FROM authoring_variation_items i JOIN authoring_projects p ON p.id=i.project_id
      WHERE ((p.status='generating' AND (i.status='pending' OR (i.status='running' AND i.lease_expires_at<?))) OR (i.status='accepting' AND i.lease_expires_at<?))
      AND NOT EXISTS(SELECT 1 FROM authoring_variation_items busy WHERE busy.project_id=p.id AND busy.status IN ('running','accepting') AND busy.lease_expires_at>=?)
      ORDER BY p.created_at,i.position LIMIT 1`).get(now, now, now) as { id:string;project_id:string;status:string;run_id:string|null;attempt:number;owner_id:string;subject:string;stage:EducationScope["stage"] } | undefined;
    if (!row) return;
    db.prepare("UPDATE authoring_variation_items SET status=?,attempt=attempt+1,revision=revision+1,error=NULL,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=?")
      .run(row.status === "accepting" ? "accepting" : "running", token, lease(), now, row.id);
    return row;
  })();
  if (!job) return;
  const scope = { subject: job.subject, stage: job.stage };
  const heartbeat = setInterval(() => {
    db.prepare("UPDATE authoring_variation_items SET lease_expires_at=? WHERE id=? AND lease_owner=? AND status IN ('running','accepting')").run(lease(), job.id, token);
  }, 30_000);
  heartbeat.unref();
  try {
    if (job.status === "accepting") { await finishAcceptance(job.owner_id, scope, job.project_id, job.id, token); return; }
    await freshSource(job.owner_id, scope, job.project_id);
    const project = requireProject(job.owner_id, scope, job.project_id), item = project.variation!.items.find(row => row.id === job.id)!;
    let run = job.run_id ? await getVariationRun(job.owner_id, job.run_id) : null;
    if (run?.status !== "awaiting_teacher") {
      const response = await generateVariationCandidates(job.owner_id, item.source.id, { count: 1, qualityMode: "reviewed", diagramMode: "auto", difficulty: project.request.variationDifficulty,
        instructions: project.request.instruction, profileId: project.request.profileId, reviewerProfileId: project.request.reviewerProfileId,
        idempotencyKey: `whole-${item.id}-${job.attempt + 1}` }, {
        onCreated: runId => {
          if (!db.prepare("UPDATE authoring_variation_items SET run_id=? WHERE id=? AND lease_owner=? AND status='running'").run(runId, job.id, token).changes) throw new Error("任务已由其他进程接管");
        },
        onStage: stage => {
          if (!db.prepare("UPDATE authoring_variation_items SET stage=?,updated_at=? WHERE id=? AND lease_owner=? AND status='running'").run(stage, time(), job.id, token).changes) throw new Error("任务已由其他进程接管");
        },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "变式生成失败");
      run = await getVariationRun(job.owner_id, result.runId);
    }
    await freshSource(job.owner_id, scope, job.project_id);
    if (run?.status !== "awaiting_teacher" || run.candidates.length !== 1 || run.candidates[0].question.type !== item.source.type) throw new Error("候选题数量或题型与原卷不一致");
    const stemKey = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/[\s$\\{}]/g, "");
    const current = requireProject(job.owner_id, scope, job.project_id);
    if (current.variation!.items.some(other => other.id !== item.id && ["awaiting_teacher", "accepting", "accepted"].includes(other.status) && other.candidate && stemKey(other.candidate.question.stem) === stemKey(run!.candidates[0].question.stem))) {
      throw new Error("这道变式与本卷其他候选题重复，请重新生成此题");
    }
    db.transaction(() => {
      const changed = db.prepare("UPDATE authoring_variation_items SET status='awaiting_teacher',run_id=?,stage=NULL,lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND lease_owner=? AND status='running'").run(run!.runId, time(), job.id, token);
      if (changed.changes) progress(job.project_id);
    })();
  } catch (error) {
    const changed = db.prepare("UPDATE authoring_variation_items SET status='failed',error=?,stage=NULL,lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND lease_owner=? AND status='running'")
      .run(error instanceof Error ? error.message.slice(0, 1500) : "变式生成失败", time(), job.id, token);
    if (changed.changes) progress(job.project_id);
  } finally { clearInterval(heartbeat); }
}

export async function publishWholePaperVariation(owner: string, scope: EducationScope, projectId: string) {
  const snapshot = await freshSource(owner, scope, projectId), project = requireProject(owner, scope, projectId);
  if (project.variation!.items.some(item => item.status !== "accepted" || !item.promotedQuestionId)) throw new Error("请逐题核对采用全部变式后再导出");
  const items = project.variation!.items;
  const questions = await getApprovedQuestions(owner, items.map(item => item.promotedQuestionId!), scope);
  if (questions.length !== items.length || items.some(item => {
    const q = questions.find(q => q.id === item.promotedQuestionId), candidate = item.candidate?.question;
    return !q || q.needsHumanReview || q.parentQuestionId !== item.source.id || q.type !== item.source.type || !candidate || q.stem !== candidate.stem || q.answer !== candidate.answer || q.analysis !== candidate.analysis || JSON.stringify(q.options ?? []) !== JSON.stringify(candidate.options ?? []);
  })) throw new Error("已采用题目发生变化或不再可用，请重新核对生成");
  return getSqlite().transaction(() => {
    const current = requireProject(owner, scope, projectId), db = getSqlite();
    if (current.revision !== project.revision) throw new Error("作品已变化，请刷新后导出");
    if (current.paperId) return { id: current.paperId };
    const mapping = new Map(items.map(item => [item.source.id, item.promotedQuestionId!]));
    const settings = { ...snapshot.settings, showAnswers: false, assetLayouts: {}, answerSpaces: {},
      questionNumbers: Object.fromEntries(items.map(item => [item.promotedQuestionId!, item.number])),
      sections: snapshot.settings.sections.map(section => ({ ...section, questionIds: section.questionIds.map(id => mapping.get(id)!) })), authoringProjectId: projectId };
    const id = randomUUID(), now = time();
    db.prepare("INSERT INTO papers(id,owner_id,title,subtitle,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, owner, project.title, `原卷：${snapshot.title}`, JSON.stringify(settings), now, now);
    const insert = db.prepare("INSERT INTO paper_items(paper_id,question_id,position,score) VALUES(?,?,?,?)");
    items.forEach((item, position) => insert.run(id, item.promotedQuestionId!, position, item.score));
    db.prepare("UPDATE authoring_projects SET paper_id=?,revision=revision+1,updated_at=? WHERE id=?").run(id, now, projectId);
    return { id };
  })();
}
