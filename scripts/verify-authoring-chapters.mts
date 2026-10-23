import assert from "node:assert/strict";
import sharp from "sharp";
import { putFile } from "../lib/file-storage.ts";
import { ensureDatabase } from "../db/bootstrap.ts";
import { getSqlite } from "../db/index.ts";
import { encryptSecret } from "../lib/secret-box.ts";
import { createAuthoringProject, readAuthoringProject, kickAuthoringPlanning } from "../server/services/authoring.ts";
import { controlAuthoringProject, kickAuthoringChapters, retryAuthoringChapter, editAuthoringChapter, approveAuthoringChapter, readyAuthoringProject, publishAuthoringPaper } from "../server/services/authoring-chapters.ts";
import { getAuthoringDocument } from "../server/services/authoring-output.ts";
import { readModel } from "../server/http/read-models.ts";
import { createPaperExportToken } from "../lib/paper-export-token.ts";

await ensureDatabase();
const db = getSqlite(), scope = { subject: "数学", stage: "high" as const }, now = new Date().toISOString();
const encrypted = await encryptSecret("synthetic-test-key");
db.prepare(`INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at) VALUES('model','teacher','Mock','openai-compatible','https://model.invalid/v1','mock',?,?,'test',?,?)`).run(encrypted.ciphertext, encrypted.iv, now, now);
db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('doc','teacher','周期题库','application/pdf','complete','数学','高三',?,?)").run(now, now);
for (let i = 1; i <= 8; i++) db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,'doc',?,'fill',?,'参考答案','用最小正周期公式计算并检查条件。','approved',1,'{}',?,?)").run(`q${i}`, String(i), `求函数 $y=\\sin(${i}x)$ 的最小正周期。`, now, now);
await putFile("assets/q1.png", await sharp({ create: { width: 50, height: 30, channels: 3, background: "white" } }).png().toBuffer());
db.prepare("INSERT INTO question_assets(id,question_id,kind,role,label,crop_key,bbox_json,created_at) VALUES('asset','q1','figure','question','题图','assets/q1.png','{}',?)").run(now);
const period = "math.high.trigonometry.period";
const slot = { role: "example", knowledgeIds: [period], difficulty: 2, type: "fill", count: 1, score: 5, purpose: "计算最小正周期" };
const chapter = { id: "period", title: "周期计算", knowledgeIds: [period], prerequisites: [], objectives: ["能够计算最小正周期"], teachingNotes: "从图象到公式说明周期的本质。", slots: [slot, { ...slot, role: "practice" }] };
const plan = { title: "周期专题讲义", audience: "高三学生", approach: "定义理解、例题示范、变式迁移逐步递进。", estimatedMinutes: 45, assumptions: [], chapters: [chapter, { ...chapter, id: "transfer", title: "周期方法迁移" }] };
const calls: string[] = [];
let reviewError = false, reviewReject = false, malformedSelection = false, stealing: (() => void) | undefined;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)), messages = body.messages;
  const system = messages.find((message: { role: string }) => message.role === "system").content;
  const user = messages.find((message: { role: string }) => message.role === "user").content;
  const input = JSON.parse(typeof user === "string" ? user : user.find((part: { type: string }) => part.type === "text").text);
  if (input.imageMapping?.length) assert.ok(Array.isArray(user) && user.some((part: { type: string }) => part.type === "image_url"), "writer and reviewer must receive actual selected question images");
  let output: unknown;
  if (system.includes("输出 JSON {items:")) {
    calls.push("select"); const chosen = new Set<string>();
    output = { items: input.pools.flatMap((pool: string[], slotIndex: number) => {
      const id = pool.find(id => !chosen.has(id)); if (!id) return []; chosen.add(id);
      return [{ slotIndex, questionId: id, selectionReason: "从角系数的识别到周期公式代入，符合本组的计算目标。" }];
    }), gaps: [] };
    if (malformedSelection) { (output as { gaps: unknown[] }).gaps = [{ slotIndex: 0, reason: "已经足量却错误报告缺题，须拒绝并修正。" }]; malformedSelection = false; }
  } else if (system.includes("独立审校教师")) {
    calls.push("review"); if (reviewError) return Response.json({ error: "temporary test failure" }, { status: 503 });
    output = { checks: (input.checks ?? []).map((check: { id: string }) => ({ id: check.id, passed: true, evidence: input.content.introduction, reason: "已逐项核对该学科要求和本章对应内容。" })), knowledge: input.content.knowledge.map((item: { id: string }) => ({ id: item.id, correct: !reviewReject, complete: true, reason: "公式条件与本章知识要求逐项核对。" })), questions: input.content.items.map((item: { questionId: string }) => ({ id: item.questionId, aligned: true, difficultyAppropriate: true, explanationCorrect: true, reason: "题目条件明确，代入公式与计算过程一致。" })) };
  } else if (system.includes("校本教辅编辑")) {
    calls.push("write"); stealing?.();
    output = { ...input.selection, introduction: "从周期的概念出发，先理解定义，再通过例题掌握计算方法。", knowledge: input.kind === "paper" ? [] : [{ id: period, title: "最小正周期", explanation: "周期函数的函数值按固定间隔重复，最小正周期是所有正周期中的最小值。研究周期时必须明确自变量的变化范围，并确认恒等关系对定义域内所有自变量成立。正弦函数的角系数会改变变化速度，因此需要使用角系数的绝对值计算周期，不能忽略非零条件。", formulas: [{ latex: "T=2\\pi/|\\omega|", conditions: "角系数非零且振幅非零。" }], method: "先识别函数中的角系数，再判断是否为正弦或余弦函数，代入最小正周期公式并验证非零条件。", misconceptions: [{ mistake: "把负的角系数直接代入。", correction: "周期取正值，应当使用角系数的绝对值。" }] }], items: input.selection.items.map((item: object) => ({ ...item, teachingExplanation: "第一步识别函数中的角系数并确认它不为零；第二步使用正弦函数最小正周期公式，取角系数的绝对值后计算。第三步把结果代回定义，检查自变量平移一个周期后函数值保持不变，从而验证结论。" })), conclusion: "本章通过定义、公式和典型题，建立了周期计算的完整步骤。" };
  } else { calls.push("plan"); output = plan; }
  return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
};
const read = (id: string) => readAuthoringProject("teacher", scope, id)!;
async function create(kind = "handout") {
  const project = await createAuthoringProject("teacher", scope, { kind, instruction: "按照周期概念、例题、练习逐步生成详尽讲义。", documentIds: ["doc"], profileId: "model" });
  await kickAuthoringPlanning();
  return controlAuthoringProject("teacher", scope, project.id, read(project.id).revision, "generate");
}
try {
  let project = await create();
  assert.equal(project.chapters.length, 2);
  await controlAuthoringProject("teacher", scope, project.id, project.revision, "pause");
  const before = calls.length; await kickAuthoringChapters(); assert.equal(calls.length, before, "paused projects must not run");
  project = await controlAuthoringProject("teacher", scope, project.id, read(project.id).revision, "resume");
  await kickAuthoringChapters(); project = read(project.id);
  assert.equal(project.chapters[0].status, "complete");
  assert.equal(project.chapters[1].status, "pending");
  await assert.rejects(() => editAuthoringChapter("teacher", scope, project.id, project.chapters[0].id, project.chapters[0].revision, project.chapters[0].content), /暂停/);
  await kickAuthoringChapters(); project = read(project.id);
  assert.equal(project.status, "reviewing");
  assert.equal(new Set(project.chapters.flatMap(c => c.content!.items.map(item => item.questionId))).size, 4);
  assert.throws(() => readyAuthoringProject("teacher", scope, project.id), /核对采用/);
  assert.throws(() => approveAuthoringChapter("other", scope, project.id, project.chapters[0].id, project.chapters[0].revision, ""), /不存在/);
  for (const c of project.chapters) approveAuthoringChapter("teacher", scope, project.id, c.id, c.revision, "");
  assert.equal(readyAuthoringProject("teacher", scope, project.id).status, "completed");
  const printed = (await getAuthoringDocument("teacher", project.id, scope, true))!;
  assert.equal(printed.chapters.length, 2);
  assert.ok(printed.chapters.flatMap(c => c.content!.questions).find(q => q.id === "q1")!.assets[0].url!.startsWith("data:image/png;base64,"), "print-only document embeds owned images without broad file authorization");
  assert.equal(await getAuthoringDocument("other", project.id), null);
  const c = read(project.id).chapters[0];
  const edited = await editAuthoringChapter("teacher", scope, project.id, c.id, c.revision, { ...c.content, conclusion: "教师补充：结合图象检查结果，区分周期和最小正周期。" });
  assert.equal(edited.chapters[0].status, "needs_review");
  await assert.rejects(() => editAuthoringChapter("teacher", scope, project.id, c.id, c.revision, c.content), /变化/);
  assert.throws(() => approveAuthoringChapter("teacher", scope, project.id, c.id, edited.chapters[0].revision, ""), /核对/);
  approveAuthoringChapter("teacher", scope, project.id, c.id, edited.chapters[0].revision, "已逐项核对公式条件及例题推导，内容可以使用。");
  const selected = c.content!.items[0].questionId;
  db.prepare("UPDATE questions SET answer='changed' WHERE id=?").run(selected);
  assert.throws(() => readyAuthoringProject("teacher", scope, project.id), /引用题目已修改/);
  db.prepare("UPDATE questions SET answer='参考答案' WHERE id=?").run(selected);

  let failure = await create(); reviewError = true;
  await kickAuthoringChapters(); failure = read(failure.id);
  assert.equal(failure.chapters[0].status, "failed"); assert.ok(failure.chapters[0].content, "preserve expensive writing after review failure");
  reviewError = false;
  await retryAuthoringChapter("teacher", scope, failure.id, failure.chapters[0].id, failure.chapters[0].revision, true);
  const counts = calls.length; await kickAuthoringChapters(); assert.deepEqual(calls.slice(counts), ["review"]);
  reviewReject = true; await kickAuthoringChapters(); failure = read(failure.id); assert.equal(failure.chapters[1].status, "needs_review"); reviewReject = false;
  await retryAuthoringChapter("teacher", scope, failure.id, failure.chapters[1].id, failure.chapters[1].revision, true);
  db.prepare("UPDATE authoring_chapters SET status='running',lease_owner='dead',lease_expires_at='2000-01-01' WHERE id=?").run(failure.chapters[1].id);
  await kickAuthoringChapters(); assert.equal(read(failure.id).chapters[1].status, "complete");

  let paper = await create("paper"); malformedSelection = true; const beforeRepair = calls.length; await kickAuthoringChapters(); assert.deepEqual(calls.slice(beforeRepair, beforeRepair + 2), ["select", "select"], "contradictory selection receives one bounded repair"); await kickAuthoringChapters(); paper = read(paper.id);
  for (const chapter of paper.chapters) approveAuthoringChapter("teacher", scope, paper.id, chapter.id, chapter.revision, "");
  const published = publishAuthoringPaper("teacher", scope, paper.id); assert.deepEqual(publishAuthoringPaper("teacher", scope, paper.id), published);
  assert.equal((db.prepare("SELECT sum(score) AS score FROM paper_items WHERE paper_id=?").get(published.id) as { score: number }).score, 20);
  const first = read(paper.id).chapters[0];
  const revised = await editAuthoringChapter("teacher", scope, paper.id, first.id, first.revision, { ...first.content, conclusion: "调整后的试卷说明，要求学生明确写出公式使用条件。" });
  approveAuthoringChapter("teacher", scope, paper.id, first.id, revised.chapters[0].revision, "已重新核对全部题目及编排，确认可以发布新版。");
  assert.notEqual(publishAuthoringPaper("teacher", scope, paper.id).id, published.id, "revised work must not return stale paper");
  const token = createPaperExportToken(`authoring:${project.id}`, "teacher");
  const view = (resource: string, id: string, token: string) => readModel(new Request("http://local/api/view", { method: "POST", body: JSON.stringify({ resource, id, token }) }));
  assert.equal((await view("authoring-print", project.id, token)).status, 200);
  assert.equal((await view("paper-print", project.id, token)).status, 404);
  assert.equal((await view("authoring-print", paper.id, token)).status, 404);

  const stale = await create();
  stealing = () => db.prepare("UPDATE authoring_chapters SET lease_owner='replacement',error='replacement-owned' WHERE id=?").run(stale.chapters[0].id);
  await kickAuthoringChapters();
  assert.equal(read(stale.id).chapters[0].error, "replacement-owned");
  assert.equal(read(stale.id).chapters[0].content, null, "stale worker must not save checkpoint");
  const liveCalls = calls.length; await kickAuthoringChapters(); assert.equal(calls.length, liveCalls, "live lease prevents another chapter racing");
  console.log("chapter workflow passed: selection, writing, review, pause/resume, cross-chapter deduplication, teacher edits, source freshness, checkpoint recovery, publication editions, print capability isolation, stale worker rejection");
} finally { globalThis.fetch = originalFetch; db.close(); }
