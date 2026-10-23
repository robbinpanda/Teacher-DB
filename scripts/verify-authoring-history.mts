import assert from "node:assert/strict";
import { ensureDatabase } from "../db/bootstrap.ts";
import { getSqlite } from "../db/index.ts";
import { encryptSecret } from "../lib/secret-box.ts";
import { getApprovedQuestions } from "../lib/question-repository.ts";
import { fingerprintRow, loadRetrievalRows } from "../lib/knowledge-retrieval.ts";
import type { SavedChapterContent } from "../lib/authoring-content.ts";
import { createAuthoringProject, readAuthoringProject } from "../server/services/authoring.ts";
import { controlAuthoringProject, replanAuthoringChapter, restoreAuthoringChapter, editAuthoringChapter, approveAuthoringChapter, readyAuthoringProject } from "../server/services/authoring-chapters.ts";
import { readAuthoringChapterVersion } from "../server/services/authoring-history.ts";

await ensureDatabase();
const db = getSqlite(), scope = { subject: "数学", stage: "high" as const }, owner = "history-teacher", time = new Date().toISOString();
const secret = await encryptSecret("synthetic-history-key");
db.prepare("INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at) VALUES('model',?,'Mock','openai-compatible','https://model.invalid/v1','mock',?,?,'test',?,?)").run(owner, secret.ciphertext, secret.iv, time, time);
db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('doc',?,'历史恢复测试','application/pdf','complete','数学','高三',?,?)").run(owner, time, time);
for (let i = 1; i <= 8; i++) db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,'doc',?,'fill',?,'参考答案','先确认角系数非零，再用周期公式计算。','approved',1,'{}',?,?)").run(`q${i}`, String(i), `求函数 sin(${i}x) 的最小正周期。`, time, time);
const period = "math.high.trigonometry.period";
const slot = { role: "example" as const, knowledgeIds: [period], difficulty: 2, type: "fill" as const, count: 1, score: 5, purpose: "理解并应用最小正周期公式" };
const chapter = { id: "period", title: "周期概念与计算", knowledgeIds: [period], prerequisites: [], objectives: ["能够说明公式条件并计算周期"], teachingNotes: "先回顾图象，再解释角系数与周期关系。", slots: [slot, { ...slot, role: "practice" as const }] };
const plan = { title: "历史恢复验证讲义", audience: "高三学生", approach: "从周期概念到计算，再用变式迁移方法。", estimatedMinutes: 60, assumptions: [], chapters: [chapter, { ...chapter, id: "transfer", title: "周期方法迁移" }] };
const read = (id: string) => readAuthoringProject(owner, scope, id)!;
const created = await createAuthoringProject(owner, scope, { kind: "handout", instruction: "编写周期讲义，先概念计算再方法迁移", profileId: "model" });
db.prepare("UPDATE authoring_projects SET plan_json=?,status='planned' WHERE id=?").run(JSON.stringify(plan), created.id);
let project = await controlAuthoringProject(owner, scope, created.id, read(created.id).revision, "generate");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("History restore must not call an external model"); };
try {
  for (const [index, entry] of project.chapters.entries()) {
    const ids = [`q${index * 2 + 1}`, `q${index * 2 + 2}`], questions = await getApprovedQuestions(owner, ids, scope);
    const content: SavedChapterContent = {
      introduction: "本章通过周期定义、典型例题和独立练习建立完整计算方法。",
      knowledge: [{ id: period, title: "最小正周期", explanation: "周期函数的函数值按固定间隔重复，最小正周期是所有正周期中的最小值。研究周期时必须明确自变量的变化范围，并确认恒等关系对定义域内所有自变量成立。正弦函数的角系数会改变变化速度，因此需要使用角系数的绝对值计算周期，不能忽略非零条件。", formulas: [{ latex: "T=2\\pi/|\\omega|", conditions: "振幅与角系数都不为零。" }], method: "先识别三角函数类型和角系数，再确认非零条件，代入最小正周期公式并检查正值。", misconceptions: [{ mistake: "忽略角系数的正负。", correction: "计算周期时使用角系数绝对值，保证所得周期为正。" }] }],
      items: ids.map((questionId, slotIndex) => ({ slotIndex, questionId, selectionReason: "先示范直接计算，再用独立练习巩固方法。", teachingExplanation: "先识别函数为正弦函数，并确认振幅和角系数都不为零。再根据解析式读出角系数，取其绝对值后代入最小正周期等于二π除以角系数绝对值的公式。最后检查结果是否为正，并代回周期定义验证平移前后函数值相等。" })),
      gaps: [], conclusion: "本章掌握周期公式的适用条件和计算步骤。", questions,
      questionFingerprints: Object.fromEntries(loadRetrievalRows(db, owner, scope, undefined, ids).map(row => [row.id, fingerprintRow(row, scope)])),
      review: { passed: true, issues: [] }, traceId: "synthetic", teacherApproval: { at: time, note: "测试数据已人工核对" },
    };
    db.prepare("UPDATE authoring_chapters SET content_json=?,status='approved' WHERE id=?").run(JSON.stringify(content), entry.id);
  }
  db.prepare("UPDATE authoring_projects SET status='completed' WHERE id=?").run(project.id);
  project = read(project.id);
  const id = project.id, target = project.chapters[0], other = project.chapters[1], preserved = JSON.stringify(other);
  const changedPlan = { ...target.plan, title: "增加练习后的周期专题", slots: target.plan.slots.map((entry, i) => ({ ...entry, score: 7, count: i ? 2 : 1 })) };
  project = await replanAuthoringChapter(owner, scope, id, target.id, target.revision, project.revision, changedPlan);
  const completeVersion = project.chapters[0].history!.find(entry => entry.revision === target.revision)!;
  assert.ok(completeVersion.hasPlan && completeVersion.hasContent);
  assert.deepEqual(readAuthoringChapterVersion(owner, scope, id, target.id, completeVersion.id)!.plan, target.plan);
  assert.equal(readAuthoringChapterVersion("other", scope, id, target.id, completeVersion.id), null);
  assert.equal(readAuthoringChapterVersion(owner, { ...scope, stage: "middle" }, id, target.id, completeVersion.id), null);
  assert.equal(readAuthoringChapterVersion(owner, scope, id, other.id, completeVersion.id), null);
  await assert.rejects(() => restoreAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, completeVersion.id), /暂停/);
  project = await controlAuthoringProject(owner, scope, id, project.revision, "pause");
  const planOnlyRevision = project.chapters[0].revision;
  await assert.rejects(() => restoreAuthoringChapter(owner, scope, id, target.id, planOnlyRevision, project.revision - 1, completeVersion.id), /变化/);
  project = await restoreAuthoringChapter(owner, scope, id, target.id, planOnlyRevision, project.revision, completeVersion.id);
  assert.equal(project.status, "paused"); assert.equal(project.chapters[0].status, "needs_review");
  assert.deepEqual(project.chapters[0].plan, target.plan); assert.deepEqual(project.plan!.chapters[0], target.plan);
  assert.equal(project.chapters[0].content!.conclusion, target.content!.conclusion);
  assert.equal(project.chapters[0].content!.teacherApproval, undefined); assert.equal(project.chapters[0].content!.review.passed, false);
  assert.equal(JSON.stringify(project.chapters[1]), preserved, "restoring must not rewrite another chapter");
  const planOnly = project.chapters[0].history!.find(entry => entry.revision === planOnlyRevision)!;
  assert.equal(planOnly.hasContent, false); assert.equal(planOnly.hasPlan, true);
  assert.equal(readAuthoringChapterVersion(owner, scope, id, target.id, planOnly.id)!.content, null);
  project = await restoreAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, planOnly.id);
  assert.equal(project.status, "paused"); assert.equal(project.chapters[0].status, "pending"); assert.equal(project.chapters[0].content, null);
  assert.deepEqual(project.plan!.chapters[0], changedPlan);
  project = await restoreAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, completeVersion.id);
  project = await controlAuthoringProject(owner, scope, id, project.revision, "resume");
  assert.throws(() => readyAuthoringProject(owner, scope, id), /核对采用/);
  project = approveAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, "已重新核对恢复的计划、选题和解析，确认内容正确。");
  assert.equal(readyAuthoringProject(owner, scope, id).workCoverage!.ready, true);

  // Change the current selection first; an old source changes while the current selection stays fresh.
  project = await editAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, { ...project.chapters[0].content, items: project.chapters[0].content!.items.map((item, i) => ({ ...item, questionId: `q${i + 5}` })) });
  db.prepare("UPDATE questions SET answer='已修订答案' WHERE id='q1'").run();
  const beforeRejected = JSON.stringify(read(id));
  await assert.rejects(() => restoreAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, completeVersion.id), /引用题目已修改/);
  assert.equal(JSON.stringify(read(id)), beforeRejected, "failed restoration must leave plan, content and history untouched");
  db.prepare("UPDATE questions SET answer='参考答案' WHERE id='q1'").run();
  project = await editAuthoringChapter(owner, scope, id, other.id, project.chapters[1].revision, { ...project.chapters[1].content, items: project.chapters[1].content!.items.map((item, i) => i ? item : { ...item, questionId: "q1" }) });
  await assert.rejects(() => restoreAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, completeVersion.id), /重复选择/);

  const beforeLegacy = project.chapters[0];
  project = await editAuthoringChapter(owner, scope, id, target.id, beforeLegacy.revision, { ...beforeLegacy.content, conclusion: "修改小结后仍保留之前的完整正文和选题。" });
  const legacy = project.chapters[0].history!.find(entry => entry.revision === beforeLegacy.revision)!;
  db.prepare("UPDATE authoring_chapter_versions SET plan_json=NULL WHERE id=?").run(legacy.id);
  assert.equal(readAuthoringChapterVersion(owner, scope, id, target.id, legacy.id)!.plan, null, "legacy history must not invent an old plan");
  project = await restoreAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, legacy.id);
  assert.equal(project.chapters[0].content!.conclusion, beforeLegacy.content!.conclusion);
  assert.match(project.chapters[0].content!.review.issues[0], /仅保存正文/);

  project = await replanAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, changedPlan);
  project = await controlAuthoringProject(owner, scope, id, project.revision, "pause");
  db.prepare("UPDATE authoring_projects SET requirements_json=? WHERE id=?").run(JSON.stringify({ numeric: [{ metric: "score", scope: "work", roles: [], types: [], levels: [], withinRoles: [], withinTypes: [], operator: "eq", value: 31, evidence: "整份共31分" }], knowledge: [], questions: [], questionTypes: [], assumptions: [] }), id);
  await assert.rejects(() => restoreAuthoringChapter(owner, scope, id, target.id, project.chapters[0].revision, project.revision, completeVersion.id), /未满足教师要求/);
  assert.deepEqual(read(id).plan!.chapters[0], changedPlan);
  console.log("history restore verified: plan/body snapshots, paused plan-only restore, project/chapter conflicts, source freshness, duplicates, legacy history, requirement gates and teacher readoption");
} finally { globalThis.fetch = originalFetch; db.close(); }
