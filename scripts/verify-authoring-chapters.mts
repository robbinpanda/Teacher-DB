import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import sharp from "sharp";
import { putFile } from "../lib/file-storage.ts";
import { ensureDatabase } from "../db/bootstrap.ts";
import { getSqlite } from "../db/index.ts";
import { encryptSecret } from "../lib/secret-box.ts";
import { createAuthoringProject, readAuthoringProject, kickAuthoringPlanning, changeAuthoringModels, inspectAuthoringCoverage } from "../server/services/authoring.ts";
import { controlAuthoringProject, kickAuthoringChapters, retryAuthoringChapter, editAuthoringChapter, restoreAuthoringChapter, replanAuthoringChapter, approveAuthoringChapter, readyAuthoringProject, publishAuthoringPaper, inspectChapterSourceUpdates, refreshChapterSources } from "../server/services/authoring-chapters.ts";
import { readAuthoringChapterVersion } from "../server/services/authoring-history.ts";
import { getAuthoringDocument } from "../server/services/authoring-output.ts";
import { readModel } from "../server/http/read-models.ts";
import { createPaperExportToken } from "../lib/paper-export-token.ts";
import { fingerprintRow, loadRetrievalRows } from "../lib/knowledge-retrieval.ts";
import { getApprovedQuestions } from "../lib/question-repository.ts";

await ensureDatabase();
const db = getSqlite(), scope = { subject: "数学", stage: "high" as const }, now = new Date().toISOString();
const encrypted = await encryptSecret("synthetic-test-key");
db.prepare(`INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at) VALUES('model','teacher','Mock','openai-compatible','https://model.invalid/v1','mock',?,?,'test',?,?)`).run(encrypted.ciphertext, encrypted.iv, now, now);
db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('doc','teacher','周期题库','application/pdf','complete','数学','高三',?,?)").run(now, now);
for (let i = 1; i <= 8; i++) db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,'doc',?,'fill',?,'参考答案','用最小正周期公式计算并检查条件。','approved',1,'{}',?,?)").run(`q${i}`, String(i), `求函数 $y=\\sin(${i}x)$ 的最小正周期。`, now, now);
await putFile("assets/q1.png", await sharp({ create: { width: 50, height: 30, channels: 3, background: "white" } }).png().toBuffer());
db.prepare("INSERT INTO question_assets(id,question_id,kind,role,label,crop_key,bbox_json,created_at) VALUES('asset','q1','figure','question','题图','assets/q1.png','{}',?)").run(now);
for (const [id, owner] of [["reviewer", "teacher"], ["foreign-reviewer", "other"]]) db.prepare("INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at) VALUES(?,?,'Mock Reviewer','openai-compatible','https://review.invalid/v1','review-mock',?,?,'test',?,?)").run(id, owner, encrypted.ciphertext, encrypted.iv, now, now);
const reviewModels: string[] = [];
const period = "math.high.trigonometry.period";
const slot = { role: "example", knowledgeIds: [period], difficulty: 2, type: "fill", count: 1, score: 5, purpose: "计算最小正周期" };
const chapter = { id: "period", title: "周期计算", knowledgeIds: [period], prerequisites: [], objectives: ["能够计算最小正周期"], teachingNotes: "从图象到公式说明周期的本质。", slots: [slot, { ...slot, role: "practice" }] };
const plan = { title: "周期专题讲义", audience: "高三学生", approach: "定义理解、例题示范、变式迁移逐步递进。", estimatedMinutes: 45, assumptions: [], chapters: [chapter, { ...chapter, id: "transfer", title: "周期方法迁移" }] };
const calls: string[] = [];
let reviewError = false, reviewReject = false, malformedSelection = false, lateSelection = false, stealing: (() => void) | undefined;
let pauseDuringWriting:string|undefined;
let wrongPracticeAnswer=false;
let conflictingAnswerReview=false;
let rejectProgression=false;
const courseStages=new Set<string>();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)), messages = body.messages;
  const system = messages.find((message: { role: string }) => message.role === "system").content;
  const user = messages.find((message: { role: string }) => message.role === "user").content;
  const input = JSON.parse(typeof user === "string" ? user : user.find((part: { type: string }) => part.type === "text").text);
  if(system.includes('输出 JSON {recommendations:')||system.includes('独立审校教师')||system.includes('校本教辅编辑')){
    const target=input.chapter??input.plan;
    assert.equal(input.courseContext.currentChapterId,target.id);
    assert.equal(input.courseContext.outline[input.courseContext.currentPosition-1].id,target.id);
    assert.ok(input.request.instruction.includes('周期'));
    assert.equal(input.courseContext.chapterCount,2);
    if(input.courseContext.currentPosition===2)assert.ok(input.courseContext.priorPlannedKnowledgeIds.includes(period));
    courseStages.add(system.includes('输出 JSON {recommendations:')?'select':system.includes('独立审校教师')?'review':input.previousContent?'revise':'write');
  }
  if (input.imageMapping?.length) assert.ok(Array.isArray(user) && user.some((part: { type: string }) => part.type === "image_url"), "writer and reviewer must receive actual selected question images");
  let output: unknown;
  if (system.includes("教学需求核对员")) { calls.push("requirements"); output = { numeric: [], knowledge: [], questions: [], assumptions: [] }; }
  else if (system.includes("输出 JSON {recommendations:")) {
    calls.push("select"); const chosen = new Set<string>();
    for (const candidate of input.candidates as Array<{id:string;eligibleSlotIndexes:number[]}>) {
      assert.deepEqual(candidate.eligibleSlotIndexes, input.pools.flatMap((pool:string[], index:number) => pool.includes(candidate.id) ? [index] : []));
    }
    assert.ok(input.candidates.every((candidate:{assessment:{prerequisites:unknown}})=>Array.isArray(candidate.assessment.prerequisites)));
    output = { items: input.pools.flatMap((pool: string[], slotIndex: number) => {
      const id = pool.find(id => !chosen.has(id) && (!lateSelection || ['late-130','late-131'].includes(id))); if (!id) return []; chosen.add(id);
      return [{ slotIndex, questionId: id, selectionReason: "从角系数的识别到周期公式代入，符合本组的计算目标。" }];
    }), gaps: [] };
    if (lateSelection) {
      assert.ok(input.candidates.every((candidate: {id:string;assessment:{difficulty:number|null}}) => candidate.id !== 'late-000' && candidate.assessment.difficulty === null), 'valid difficulty-5 question must not enter difficulty-2 pools');
      const selected = output as {items:Array<{slotIndex:number}>;gaps:Array<{slotIndex:number;reason:string}>};
      selected.gaps = input.chapter.slots.flatMap((_:unknown,slotIndex:number) => selected.items.some(item=>item.slotIndex===slotIndex)?[]:[{slotIndex,reason:'本批候选尚不满足本组教学要求，继续比较后续题目。'}]);
    }

    const selected = output as {items:Array<{slotIndex:number;questionId:string;selectionReason:string}>;gaps:unknown[]};
    output = {gapReasons:selected.gaps,recommendations:selected.items.map(item=>{
      const candidate=input.candidates.find((candidate:{id:string})=>candidate.id===item.questionId);
      const choice=candidate.eligibleChoices.find((choice:{slotIndex:number})=>choice.slotIndex===item.slotIndex);
      assert.ok(choice,'every model selection must copy an actual eligible choice');
      return {choiceId:choice.choiceId,selectionReason:item.selectionReason};
    })};
    if (malformedSelection) { (output as {recommendations:Array<{choiceId:string}>}).recommendations[0].choiceId="S999-Q999"; malformedSelection=false; }
  } else if (system.includes("独立审校教师")) {
    calls.push("review"); reviewModels.push(body.model); if (reviewError) return Response.json({ error: "temporary test failure" }, { status: 503 });
    assert.ok(input.evidenceSources.some((source: { ref: string; text: string }) => source.ref === "introduction:0" && source.text === input.content.introduction));
    assert.ok(input.evidenceSources.every((source: { path: string }) => !source.path.startsWith("review")));
    output = { checks: (input.checks ?? []).map((check: { id: string }) => ({ id: check.id, passed: true, evidenceRefs: ["introduction:0"], reason: "已逐项核对该学科要求和本章对应内容。" })), knowledge: input.content.knowledge.map((item: { id: string }) => ({ id: item.id, correct: !reviewReject, complete: true, reason: "公式条件与本章知识要求逐项核对。" })), questions: input.content.items.map((item: { questionId: string },index:number) => ({ id: item.questionId, solvable: true, answerCorrect: !(wrongPracticeAnswer && index===1), computedAnswer: "$2\\pi$", aligned: true, difficultyAppropriate: true, explanationCorrect: true, reason: wrongPracticeAnswer && index===1 ? "原题参考答案与复算结果矛盾，须更换题目或修复原题。" : "题目条件明确，代入公式与计算过程一致。" })) };
    if(conflictingAnswerReview)(output as {questions:Array<{reason:string}>}).questions[0].reason='复算结果与参考答案不符。修正：answerCorrect应为false。';
    const progression=(output as {checks:Array<{id:string;passed:boolean;reason:string}>}).checks.find(check=>check.id==='curriculum.progression');
    assert.equal(!!progression,['handout','book'].includes(input.request.kind));
    if(rejectProgression&&progression){progression.passed=false;progression.reason='基础例题依赖尚未引入的后章方法，当前正文没有说明，须更换题目。';}
  } else if (system.includes("校本教辅编辑")) {
    calls.push(input.previousContent ? "revise" : "write"); stealing?.();
    if(pauseDuringWriting){const id=pauseDuringWriting;pauseDuringWriting=undefined;await controlAuthoringProject('teacher',scope,id,readAuthoringProject('teacher',scope,id)!.revision,'pause');}
    output = { ...input.selection, introduction: "从周期的概念出发，先理解定义，再通过例题掌握计算方法。", knowledge: input.kind === "paper" ? [] : [{ id: period, title: "最小正周期", explanation: "周期函数的函数值按固定间隔重复，最小正周期是所有正周期中的最小值。研究周期时必须明确自变量的变化范围，并确认恒等关系对定义域内所有自变量成立。正弦函数的角系数会改变变化速度，因此需要使用角系数的绝对值计算周期，不能忽略非零条件。", formulas: [{ latex: "T=2\\pi/|\\omega|", conditions: "角系数非零且振幅非零。" }], method: "先识别函数中的角系数，再判断是否为正弦或余弦函数，代入最小正周期公式并验证非零条件。", misconceptions: [{ mistake: "把负的角系数直接代入。", correction: "周期取正值，应当使用角系数的绝对值。" }] }], items: input.selection.items.map((item: object) => ({ ...item, teachingExplanation: "第一步识别函数中的角系数并确认它不为零；第二步使用正弦函数最小正周期公式，取角系数的绝对值后计算。第三步把结果代回定义，检查自变量平移一个周期后函数值保持不变，从而验证结论。" })), conclusion: "本章通过定义、公式和典型题，建立了周期计算的完整步骤。" };
  } else { calls.push("plan"); output = input.request.kind === "paper" ? { ...plan, chapters: plan.chapters.map(chapter => ({ ...chapter, slots: chapter.slots.map(slot => ({ ...slot, role: "assessment" })) })) } : plan; }
  return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
};
const read = (id: string) => readAuthoringProject("teacher", scope, id)!;
async function create(kind = "handout", documentId = "doc") {
  const project = await createAuthoringProject("teacher", scope, { kind, instruction: "按照周期概念、例题、练习逐步生成详尽讲义。", documentIds: [documentId], profileId: "model", reviewerProfileId: "reviewer" });
  await kickAuthoringPlanning();
  return controlAuthoringProject("teacher", scope, project.id, read(project.id).revision, "generate");
}
try {
  await assert.rejects(() => createAuthoringProject("teacher", scope, { kind: "handout", instruction: "生成周期专题讲义以便核对内容", profileId: "model", reviewerProfileId: "foreign-reviewer" }), /模型配置/);
  let project = await create();
  await assert.rejects(() => changeAuthoringModels("teacher", scope, project.id, project.revision, "model", "reviewer"), /暂停/);
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
  assert.ok(reviewModels.every(model => model === "review-mock"), "all initial reviews must use the chosen reviewer");
  const beforeModels = read(project.id), savedChapters = JSON.stringify(beforeModels.chapters);
  assert.equal(beforeModels.chapters[0].content!.review.modelProfileId, "reviewer");
  await assert.rejects(() => changeAuthoringModels("other", scope, project.id, beforeModels.revision, "model"), /不存在/);
  await assert.rejects(() => changeAuthoringModels("teacher", scope, project.id, beforeModels.revision, "model", "foreign-reviewer"), /模型配置/);
  project = await changeAuthoringModels("teacher", scope, project.id, beforeModels.revision, "model");
  assert.equal(JSON.stringify(project.chapters), savedChapters, "changing future models must not alter saved content or adoption");
  assert.equal(project.request.reviewerProfileId, undefined);
  await assert.rejects(() => changeAuthoringModels("teacher", scope, project.id, beforeModels.revision, "model", "reviewer"), /变化/);
  await retryAuthoringChapter("teacher", scope, project.id, project.chapters[0].id, project.chapters[0].revision, "review");
  await kickAuthoringChapters(); project = read(project.id);
  assert.equal(reviewModels.at(-1), "mock"); assert.equal(project.chapters[0].content!.review.modelProfileId, "model");
  project = approveAuthoringChapter("teacher", scope, project.id, project.chapters[0].id, project.chapters[0].revision, "");
  project = await changeAuthoringModels("teacher", scope, project.id, project.revision, "model", "reviewer");
  db.prepare("UPDATE model_profiles SET enabled=0 WHERE id='model'").run();
  await retryAuthoringChapter("teacher", scope, project.id, project.chapters[0].id, project.chapters[0].revision, "review");
  await kickAuthoringChapters(); project = read(project.id);
  assert.equal(project.chapters[0].status, "complete", "review-only work must not require an enabled writer");
  assert.equal(project.chapters[0].content!.review.modelDisplayName, "Mock Reviewer");
  db.prepare("UPDATE model_profiles SET enabled=1 WHERE id='model'").run();
  project = approveAuthoringChapter("teacher", scope, project.id, project.chapters[0].id, project.chapters[0].revision, "");
  const printed = (await getAuthoringDocument("teacher", project.id, scope, true))!;
  assert.equal(printed.chapters.length, 2);
  assert.ok(printed.chapters.flatMap(c => c.content!.questions).find(q => q.id === "q1")!.assets[0].url!.startsWith("data:image/png;base64,"), "print-only document embeds owned images without broad file authorization");
  assert.equal(await getAuthoringDocument("other", project.id), null);
  const c = read(project.id).chapters[0];
  const edited = await editAuthoringChapter("teacher", scope, project.id, c.id, c.revision, { ...c.content, conclusion: "教师补充：结合图象检查结果，区分周期和最小正周期。" });
  assert.equal(edited.chapters[0].status, "needs_review");
  assert.equal(edited.chapters[0].content!.review.questionChecks,undefined,'edited content must not retain stale per-question verification');
  assert.deepEqual(edited.chapters[0].content!.selectionAudit,c.content!.selectionAudit,'teacher editing preserves the actual comparison record');
  await assert.rejects(() => editAuthoringChapter("teacher", scope, project.id, c.id, c.revision, c.content), /变化/);
  assert.throws(() => approveAuthoringChapter("teacher", scope, project.id, c.id, edited.chapters[0].revision, ""), /核对/);
  approveAuthoringChapter("teacher", scope, project.id, c.id, edited.chapters[0].revision, "已逐项核对公式条件及例题推导，内容可以使用。");
  const selected = c.content!.items[0].questionId;
  db.prepare("UPDATE questions SET answer='changed' WHERE id=?").run(selected);
  assert.equal(read(project.id).workCoverage!.ready, false);
  assert.ok(read(project.id).workCoverage!.staleQuestionIds.includes(selected));
  assert.throws(() => readyAuthoringProject("teacher", scope, project.id), /引用题目已修改/);
  const beforeRefresh = read(project.id), oldChapter = beforeRefresh.chapters[0], oldContent = structuredClone(oldChapter.content!);
  let updates = await inspectChapterSourceUpdates('teacher',scope,project.id,c.id);
  assert.equal(updates.changes.length,1);assert.equal(updates.changes[0].before!.answer,'参考答案');assert.equal(updates.changes[0].after!.answer,'changed');
  assert.equal(read(project.id).chapters[0].revision,oldChapter.revision,'preview must not mutate a chapter');
  await assert.rejects(()=>inspectChapterSourceUpdates('other',scope,project.id,c.id),/不存在/);
  const retained=await editAuthoringChapter('teacher',scope,project.id,c.id,oldChapter.revision,oldContent);
  assert.equal(retained.chapters[0].content!.questions.find(q=>q.id===selected)!.answer,'参考答案','editing prose must not silently refresh retained source snapshots');
  assert.ok(retained.workCoverage!.staleQuestionIds.includes(selected));
  assert.throws(()=>approveAuthoringChapter('teacher',scope,project.id,c.id,retained.chapters[0].revision,'已检查文字但原题版本尚未更新，不能绕过来源门槛。'),/引用题目已修改/);
  updates=await inspectChapterSourceUpdates('teacher',scope,project.id,c.id);
  const expected=Object.fromEntries(updates.changes.map(change=>[change.id,change.version!]));
  db.prepare("UPDATE questions SET answer='changed again' WHERE id=?").run(selected);
  await assert.rejects(()=>refreshChapterSources('teacher',scope,project.id,c.id,updates.revision,updates.projectRevision,expected),/刚才查看/);
  db.prepare("UPDATE questions SET answer='changed' WHERE id=?").run(selected);
  const modelCallsBeforeRefresh=calls.length;
  const refreshed=await refreshChapterSources('teacher',scope,project.id,c.id,updates.revision,updates.projectRevision,expected);
  assert.equal(calls.length,modelCallsBeforeRefresh,'source refresh must not regenerate prose or call models');
  const newChapter=refreshed.chapters[0];
  assert.equal(newChapter.status,'needs_review');assert.equal(newChapter.content!.review.passed,false);assert.equal(newChapter.content!.teacherApproval,undefined);assert.equal(newChapter.content!.review.questionChecks,undefined);
  for(const field of ['introduction','knowledge','items','conclusion'] as const)assert.deepEqual(newChapter.content![field],oldContent[field],`preserve ${field}`);
  assert.equal(newChapter.content!.questions.find(q=>q.id===selected)!.answer,'changed');
  assert.deepEqual(refreshed.chapters[1],beforeRefresh.chapters[1],'other chapters remain untouched');
  assert.ok(newChapter.history!.some(version=>readAuthoringChapterVersion('teacher',scope,project.id,c.id,version.id)?.content?.questions.find(q=>q.id===selected)?.answer==='参考答案'),'old source snapshot remains viewable');
  assert.throws(()=>approveAuthoringChapter('teacher',scope,project.id,c.id,newChapter.revision,''),/核对/);
  assert.throws(()=>readyAuthoringProject('teacher',scope,project.id),/采用/);
  await assert.rejects(()=>refreshChapterSources('teacher',scope,project.id,c.id,updates.revision,updates.projectRevision,expected),/变化/);
  // Type-only changes are not classification-fingerprint changes, but must be
  // visible and must not silently violate this chapter's fill-in requirement.
  db.prepare("UPDATE questions SET type='answer' WHERE id=?").run(selected);
  assert.ok(read(project.id).workCoverage!.staleQuestionIds.includes(selected),'coverage must also exclude type-only source changes');
  const typeUpdate=await inspectChapterSourceUpdates('teacher',scope,project.id,c.id);assert.equal(typeUpdate.changes.length,1);assert.equal(typeUpdate.changes[0].after!.type,'answer');
  await assert.rejects(()=>refreshChapterSources('teacher',scope,project.id,c.id,typeUpdate.revision,typeUpdate.projectRevision,Object.fromEntries(typeUpdate.changes.map(change=>[change.id,change.version!]))),/题型/);
  db.prepare("UPDATE questions SET type='fill',status='pending' WHERE id=?").run(selected);
  const unavailable=await inspectChapterSourceUpdates('teacher',scope,project.id,c.id);assert.equal(unavailable.changes[0].after,null);
  await assert.rejects(()=>refreshChapterSources('teacher',scope,project.id,c.id,unavailable.revision,unavailable.projectRevision,{}),/移除、退出审核/);
  const otherSelected=oldContent.items.find(item=>item.questionId!==selected)!.questionId;
  db.prepare("UPDATE questions SET answer='another simultaneous edit' WHERE id=?").run(otherSelected);
  const dropped=newChapter.content!.items.find(item=>item.questionId===selected)!;
  const without=await editAuthoringChapter('teacher',scope,project.id,c.id,newChapter.revision,{...newChapter.content,items:newChapter.content!.items.filter(item=>item.questionId!==selected),gaps:[{slotIndex:dropped.slotIndex,reason:'原题退出审核，先移除并保留缺口，稍后补充。'}]});
  assert.equal(without.chapters[0].content!.items.length,oldContent.items.length-1,'unavailable old reference must not prevent removing it');
  assert.equal(without.chapters[0].content!.gaps.length,1);
  assert.equal(without.chapters[0].content!.questions.find(q=>q.id===otherSelected)!.answer,'参考答案','replacing an unavailable reference must preserve another changed source as its old snapshot');
  assert.ok(without.workCoverage!.staleQuestionIds.includes(otherSelected));
  assert.throws(()=>approveAuthoringChapter('teacher',scope,project.id,c.id,without.chapters[0].revision,'已核对其他题目和正文，但这里仍有缺题。'),/缺题/);
  db.prepare("UPDATE questions SET status='approved',type='fill' WHERE id=?").run(selected);
  db.prepare("UPDATE questions SET answer='参考答案' WHERE id=?").run(otherSelected);
  db.prepare("UPDATE questions SET answer='参考答案' WHERE id=?").run(selected);
  const resetChapter=read(project.id).chapters[0];
  project=await editAuthoringChapter('teacher',scope,project.id,c.id,resetChapter.revision,oldContent);
  project=approveAuthoringChapter('teacher',scope,project.id,c.id,project.chapters[0].revision,'已恢复测试原题并逐项核对章节内容，继续验证原有导出流程。');

  let failure = await create(); reviewError = true;
  await kickAuthoringChapters(); failure = read(failure.id);
  assert.equal(failure.chapters[0].status, "failed"); assert.ok(failure.chapters[0].content, "preserve expensive writing after review failure");
  reviewError = false;
  await retryAuthoringChapter("teacher", scope, failure.id, failure.chapters[0].id, failure.chapters[0].revision, "review");
  const counts = calls.length; await kickAuthoringChapters(); assert.deepEqual(calls.slice(counts), ["review"]);
  reviewReject = true; const revisionStart = calls.length; await kickAuthoringChapters(); failure = read(failure.id); assert.equal(failure.chapters[1].status, "needs_review"); reviewReject = false;
  assert.deepEqual(calls.slice(revisionStart), ["select", "write", "review", "revise", "review"], "failed review gets exactly one automatic revision and independent recheck");
  assert.ok(failure.chapters[1].history!.length >= 3, "preserve writing and review history");
  await retryAuthoringChapter("teacher", scope, failure.id, failure.chapters[1].id, failure.chapters[1].revision, "review");
  db.prepare("UPDATE authoring_chapters SET status='running',lease_owner='dead',lease_expires_at='2000-01-01' WHERE id=?").run(failure.chapters[1].id);
  await kickAuthoringChapters(); assert.equal(read(failure.id).chapters[1].status, "complete");

  let paper = await create("paper"); malformedSelection = true; const beforeRepair = calls.length; await kickAuthoringChapters(); assert.deepEqual(calls.slice(beforeRepair, beforeRepair + 2), ["select", "select"], "unknown recommendation code receives one bounded repair"); await kickAuthoringChapters(); paper = read(paper.id);
  for (const chapter of paper.chapters) approveAuthoringChapter("teacher", scope, paper.id, chapter.id, chapter.revision, "");
  const published = publishAuthoringPaper("teacher", scope, paper.id); assert.deepEqual(publishAuthoringPaper("teacher", scope, paper.id), published);
  assert.equal((db.prepare("SELECT sum(score) AS score FROM paper_items WHERE paper_id=?").get(published.id) as { score: number }).score, 20);
  const publishedChapter=read(paper.id).chapters[0],publishedQuestion=publishedChapter.content!.items[0].questionId;
  db.prepare("UPDATE questions SET analysis='发布后修复原解析，需更新引用并重新核对。' WHERE id=?").run(publishedQuestion);
  const publishedChanges=await inspectChapterSourceUpdates('teacher',scope,paper.id,publishedChapter.id);
  const unpublished=await refreshChapterSources('teacher',scope,paper.id,publishedChapter.id,publishedChanges.revision,publishedChanges.projectRevision,Object.fromEntries(publishedChanges.changes.map(change=>[change.id,change.version!])));
  assert.equal(unpublished.paperId,null);assert.ok(db.prepare('SELECT id FROM papers WHERE id=?').get(published.id),'previous published edition is retained');
  assert.throws(()=>publishAuthoringPaper('teacher',scope,paper.id),/采用/);
  db.prepare("UPDATE questions SET analysis='用最小正周期公式计算并检查条件。' WHERE id=?").run(publishedQuestion);
  const revertedChanges=await inspectChapterSourceUpdates('teacher',scope,paper.id,publishedChapter.id);
  const reverted=await refreshChapterSources('teacher',scope,paper.id,publishedChapter.id,revertedChanges.revision,revertedChanges.projectRevision,Object.fromEntries(revertedChanges.changes.map(change=>[change.id,change.version!])));
  approveAuthoringChapter('teacher',scope,paper.id,publishedChapter.id,reverted.chapters[0].revision,'已重新核对修复后的原题及试卷引用，原发布版本仍保留。');
  const first = read(paper.id).chapters[0];
  const revised = await editAuthoringChapter("teacher", scope, paper.id, first.id, first.revision, { ...first.content, conclusion: "调整后的试卷说明，要求学生明确写出公式使用条件。" });
  approveAuthoringChapter("teacher", scope, paper.id, first.id, revised.chapters[0].revision, "已重新核对全部题目及编排，确认可以发布新版。");
  assert.notEqual(publishAuthoringPaper("teacher", scope, paper.id).id, published.id, "revised work must not return stale paper");
  const token = createPaperExportToken(`authoring:${project.id}`, "teacher");
  const view = (resource: string, id: string, token: string) => readModel(new Request("http://local/api/view", { method: "POST", body: JSON.stringify({ resource, id, token }) }));
  assert.equal((await view("authoring-print", project.id, token)).status, 200);
  assert.equal((await view("paper-print", project.id, token)).status, 404);
  assert.equal((await view("authoring-print", paper.id, token)).status, 404);

  const currentChapter = read(project.id).chapters[0];
  const previous = currentChapter.history!.find(version => readAuthoringChapterVersion("teacher", scope, project.id, currentChapter.id, version.id)?.content?.conclusion === c.content!.conclusion)!;
  assert.ok(previous);
  assert.equal(readAuthoringChapterVersion("other", scope, project.id, currentChapter.id, previous.id), null);
  const restored = await restoreAuthoringChapter("teacher", scope, project.id, currentChapter.id, currentChapter.revision, read(project.id).revision, previous.id);
  assert.equal(restored.chapters[0].content!.conclusion, c.content!.conclusion);
  assert.equal(restored.chapters[0].status, "needs_review", "restore invalidates approval");
  assert.ok(restored.chapters[0].history!.some(version => version.revision === currentChapter.revision), "restoring preserves the replaced version");
  await assert.rejects(() => restoreAuthoringChapter("teacher", scope, project.id, currentChapter.id, currentChapter.revision, read(project.id).revision, previous.id), /变化/);

  const beforePlan = read(project.id), target = beforePlan.chapters[0], preserved = JSON.stringify(beforePlan.chapters[1]);
  const newPlan = { ...target.plan, title: "周期计算与易错回顾", teachingNotes: "增加角系数非零和最小性证明的讲解。", slots: target.plan.slots.map(slot => ({ ...slot, score: 3 })) };
  await assert.rejects(() => replanAuthoringChapter("other", scope, project.id, target.id, target.revision, beforePlan.revision, newPlan), /作品不存在/);
  await assert.rejects(() => replanAuthoringChapter("teacher", scope, project.id, target.id, target.revision, beforePlan.revision - 1, newPlan), /已变化/);
  let replanned = await replanAuthoringChapter("teacher", scope, project.id, target.id, target.revision, beforePlan.revision, newPlan);
  assert.equal(replanned.chapters[0].content, null); assert.equal(replanned.chapters[0].status, "pending");
  assert.equal(replanned.plan!.chapters[0].title, newPlan.title); assert.equal(JSON.stringify(replanned.chapters[1]), preserved);
  assert.equal(replanned.workCoverage!.ready, false); assert.ok(replanned.chapters[0].history!.some(version => version.revision === target.revision));
  replanned = await controlAuthoringProject("teacher", scope, project.id, replanned.revision, "pause");
  const pausedCalls = calls.length; await kickAuthoringChapters(); assert.equal(calls.length, pausedCalls);
  await controlAuthoringProject("teacher", scope, project.id, replanned.revision, "resume"); await kickAuthoringChapters();
  const completedAgain = read(project.id); assert.equal(completedAgain.chapters[0].status, "complete"); assert.equal(JSON.stringify(completedAgain.chapters[1]), preserved);
  approveAuthoringChapter("teacher", scope, project.id, target.id, completedAgain.chapters[0].revision, "");
  assert.equal(readyAuthoringProject("teacher", scope, project.id).workCoverage!.ready, true);

  // A second connection must not commit between a transactional version read and write.
  const signal = new Int32Array(new SharedArrayBuffer(12));
  const contender = new Worker(`
    const {workerData}=require('node:worker_threads');
    const Database=require(workerData.module), db=new Database(workerData.path,{timeout:100});
    const signal=new Int32Array(workerData.signal);
    Atomics.store(signal,0,1);Atomics.notify(signal,0);
    Atomics.wait(signal,1,0,5000);
    try {db.prepare("UPDATE documents SET updated_at=updated_at WHERE id='doc'").run();Atomics.store(signal,2,1);}
    catch(error){Atomics.store(signal,2,error.code==='SQLITE_BUSY'?2:3);}
    finally{Atomics.notify(signal,2);db.close();}
  `, { eval: true, workerData: { module: createRequire(import.meta.url).resolve("better-sqlite3"), path: db.name, signal: signal.buffer } });
  const exited = new Promise<number>(resolve => contender.once("exit", resolve));
  Atomics.wait(signal,0,0,5000);assert.equal(Atomics.load(signal,0),1);
  const originalPrepare = db.prepare;
  let challenged = false;
  db.prepare = ((sql: string) => {
    const statement = originalPrepare.call(db, sql);
    if (sql.startsWith("SELECT * FROM authoring_projects")) {
      const get = statement.get.bind(statement) as (...args: unknown[]) => unknown;
      statement.get = (...args: unknown[]) => {
        const row = get(...args);
        if (db.inTransaction && !challenged) {
          challenged = true;Atomics.store(signal,1,1);Atomics.notify(signal,1);
          Atomics.wait(signal,2,0,5000);
          assert.equal(Atomics.load(signal,2),2,"competing writer must wait until this version-checked mutation commits");
        }
        return row;
      };
    }
    return statement;
  }) as typeof db.prepare;
  try { await changeAuthoringModels("teacher",scope,project.id,read(project.id).revision,"model","reviewer"); }
  finally { db.prepare=originalPrepare;Atomics.store(signal,1,1);Atomics.notify(signal,1);await exited; }
  assert.ok(challenged);

  const stale = await create();
  stealing = () => db.prepare("UPDATE authoring_chapters SET lease_owner='replacement',error='replacement-owned' WHERE id=?").run(stale.chapters[0].id);
  await kickAuthoringChapters();
  assert.equal(read(stale.id).chapters[0].error, "replacement-owned");
  assert.equal(read(stale.id).chapters[0].content, null, "stale worker must not save checkpoint");
  const liveCalls = calls.length; await kickAuthoringChapters(); assert.equal(calls.length, liveCalls, "live lease prevents another chapter racing");
  stealing=undefined;lateSelection=true;
  db.prepare("UPDATE authoring_projects SET status='paused' WHERE status='generating'").run();
  db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('late-doc','teacher','分批候选','application/pdf','complete','数学','高三',?,?)").run(now,now);
  for(let i=0;i<132;i++)db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,'late-doc',?,'fill',?,'参考答案','最小正周期公式','approved',1,'{}',?,?)").run(`late-${String(i).padStart(3,'0')}`,String(i),`求函数 sin(${i+100}x) 的最小正周期。`,now,now);
  const wrong=loadRetrievalRows(db,'teacher',scope,['late-doc'],['late-000'])[0];
  const classification={knowledge:[{id:period,evidence:'题干考查最小正周期的计算'}],methods:['公式变形'],competencies:['数学运算'],difficulty:5,difficultyReason:'此处模拟教师确认的高难度标签',prerequisites:[],confidence:.9};
  db.prepare("INSERT INTO question_classifications(question_id,owner_id,fingerprint,catalog_version,content_json,status,created_at,updated_at) VALUES('late-000','teacher',?,'test',?,'confirmed',?,?)").run(fingerprintRow(wrong,scope),JSON.stringify(classification),now,now);
  const late=await create('handout','late-doc');await kickAuthoringChapters();const lateChapter=read(late.id).chapters[0];
  assert.equal(lateChapter.status,'complete',lateChapter.error??'');
  assert.deepEqual(new Set(lateChapter.content!.items.map(item=>item.questionId)),new Set(['late-130','late-131']));
  assert.equal(lateChapter.content!.selectionAudit!.rounds,6);assert.ok(lateChapter.content!.selectionAudit!.slots.every(slot=>slot.eligible===131&&slot.compared===131&&slot.remaining===0));
  assert.equal(lateChapter.content!.selectionAudit!.traceIds.length,6);
  lateSelection=false;db.prepare("UPDATE authoring_projects SET status='paused' WHERE status='generating'").run();
  const pausedWriter=await create();pauseDuringWriting=pausedWriter.id;
  const reviewsBefore=calls.filter(call=>call==='review').length;
  await kickAuthoringChapters();let writerState=read(pausedWriter.id);
  assert.equal(writerState.status,'paused');assert.equal(writerState.chapters[0].status,'pending');assert.ok(writerState.chapters[0].content);
  assert.equal(writerState.chapters[0].selectionProgress,undefined);assert.equal(calls.filter(call=>call==='review').length,reviewsBefore);
  const selectionsBefore=calls.filter(call=>call==='select').length,writesBefore=calls.filter(call=>call==='write').length;
  await controlAuthoringProject('teacher',scope,writerState.id,writerState.revision,'resume');await kickAuthoringChapters();writerState=read(pausedWriter.id);
  assert.equal(writerState.chapters[0].status,'complete');assert.equal(calls.filter(call=>call==='select').length,selectionsBefore);assert.equal(calls.filter(call=>call==='write').length,writesBefore);assert.equal(calls.filter(call=>call==='review').length,reviewsBefore+1);
  db.prepare("UPDATE authoring_projects SET status='paused' WHERE status='generating'").run();
  wrongPracticeAnswer=true;const badAnswerProject=await create();await kickAuthoringChapters();const badAnswerChapter=read(badAnswerProject.id).chapters[0];wrongPracticeAnswer=false;
  assert.equal(badAnswerChapter.status,'needs_review');assert.equal(badAnswerChapter.content!.review.passed,false);
  assert.equal(badAnswerChapter.content!.review.questionChecks!.length,2);
  assert.equal(badAnswerChapter.content!.review.questionChecks![1].answerCorrect,false);
  assert.ok(badAnswerChapter.content!.review.questionChecks![1].computedAnswer);
  assert.equal(badAnswerChapter.content!.questions[1].answer,'参考答案','review/revision must not silently overwrite the bank answer');
  assert.throws(()=>approveAuthoringChapter('teacher',scope,badAnswerProject.id,badAnswerChapter.id,badAnswerChapter.revision,''),/核对/);
  db.prepare("UPDATE authoring_projects SET status='paused' WHERE status='generating'").run();
  conflictingAnswerReview=true;const conflictProject=await create();const beforeConflict=calls.length;await kickAuthoringChapters();conflictingAnswerReview=false;
  const conflictChapter=read(conflictProject.id).chapters[0];assert.equal(conflictChapter.status,'failed');assert.match(conflictChapter.error!,/矛盾/);assert.ok(conflictChapter.content,'preserve the written chapter');
  assert.deepEqual(calls.slice(beforeConflict),['select','write','review'],'a contradictory academic verdict must not become a format-repair or automatic revision call');
  // Four distinct questions must survive all stages, including cross-chapter filtering.
  db.prepare("UPDATE authoring_projects SET status='paused' WHERE status='generating'").run();
  db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('identity-doc','teacher','去重边界','application/pdf','complete','数学','高三',?,?)").run(now,now);
  for(const [id,stem] of [
    ['identity-a',String.raw`求函数 $y=\sin(\frac{1}{23}x)$ 的最小正周期。`],
    ['identity-b',String.raw`求函数 $y=\sin(\frac{12}{3}x)$ 的最小正周期。`],
    ['identity-c','如图，求函数的最小正周期。'],['identity-d','如图，求函数的最小正周期。'],
    ['identity-copy',String.raw`求函数 $y=\sin(\dfrac {1} {23}x)$ 的最小正周期。`],
  ]) db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,'identity-doc',?,'fill',?,'参考答案','求最小正周期并核对条件。','approved',1,'{}',?,?)").run(id,id,stem,now,now);
  for(const [id,background] of [['identity-c','white'],['identity-d','black']]){
    const key=`assets/${id}.png`;await putFile(key,await sharp({create:{width:40,height:20,channels:3,background}}).png().toBuffer());
    db.prepare("INSERT INTO question_assets(id,question_id,kind,role,label,crop_key,bbox_json,created_at) VALUES(?,?,'graph','question','题图',?,'{}',?)").run(id,id,key,now);
  }
  for(const row of loadRetrievalRows(db,'teacher',scope,['identity-doc']))db.prepare("INSERT INTO question_classifications(question_id,owner_id,fingerprint,catalog_version,content_json,status,created_at,updated_at) VALUES(?,'teacher',?,'test',?,'confirmed',?,?)").run(row.id,fingerprintRow(row,scope),JSON.stringify({...classification,difficulty:2}),now,now);
  const identity=await create('handout','identity-doc');
  assert.equal(inspectAuthoringCoverage('teacher',scope,identity.id).flatMap(chapter=>chapter.slots).reduce((n,slot)=>n+slot.allocatedConfirmedCount,0),4);
  await kickAuthoringChapters();await kickAuthoringChapters();
  const distinct=read(identity.id);assert.ok(distinct.chapters.every(chapter=>chapter.status==='complete'),JSON.stringify(distinct.chapters.map(c=>c.error)));
  assert.equal(new Set(distinct.chapters.flatMap(chapter=>chapter.content!.items.map(item=>item.questionId))).size,4);
  assert.equal(distinct.workCoverage!.selectedQuestions,4);assert.deepEqual(distinct.workCoverage!.duplicateQuestionIds,[]);
  const second=distinct.chapters[1],copy={...second.content!,items:second.content!.items.map((item,index)=>index===0?{...item,questionId:'identity-copy'}:item)};
  await assert.rejects(()=>editAuthoringChapter('teacher',scope,identity.id,second.id,second.revision,copy),/重复题/);
  for(const chapter of distinct.chapters)approveAuthoringChapter('teacher',scope,identity.id,chapter.id,chapter.revision,'');
  assert.equal(readyAuthoringProject('teacher',scope,identity.id).status,'completed');
  const identityPrint=(await getAuthoringDocument('teacher',identity.id,scope,true))!;
  assert.equal(identityPrint.chapters.flatMap(chapter=>chapter.content!.questions).length,4);
  const figures=identityPrint.chapters.flatMap(chapter=>chapter.content!.questions).filter(question=>question.id==='identity-c'||question.id==='identity-d');
  assert.equal(figures.length,2);assert.notEqual(figures[0].assets[0].url,figures[1].assets[0].url,'both distinct figures survive print preparation');
  // A pre-existing approved question can still have unusable option labels.
  for (const planned of plan.chapters) for (const item of planned.slots) item.type='any';
  db.prepare("UPDATE questions SET type='single',options_json=?,answer='A' WHERE id='identity-copy'").run(JSON.stringify([{key:'A',content:'π'},{key:'A',content:'2π'}]));
  const structural=await create('handout','identity-doc');
  assert.ok(inspectAuthoringCoverage('teacher',scope,structural.id).flatMap(c=>c.slots).every(s=>s.structureBlockedCount===1));
  await kickAuthoringChapters();await kickAuthoringChapters();
  const usable=read(structural.id),structureChapter=usable.chapters[0];
  assert.ok(usable.chapters.every(c=>c.status==='complete'));
  assert.ok(usable.chapters.every(c=>c.content!.selectionAudit!.structureExclusions!.every(s=>s.count===1)));
  const badItems=structureChapter.content!.items.map((item,index)=>index===0?{...item,questionId:'identity-copy'}:item);
  await assert.rejects(()=>editAuthoringChapter('teacher',scope,usable.id,structureChapter.id,structureChapter.revision,{...structureChapter.content,items:badItems}),/选项编号重复/);
  // Simulate a legacy snapshot whose source fingerprint still matches. It must
  // not be adopted/exported, but replacing its broken question must be possible.
  const broken={...structureChapter.content!,items:badItems,questions:await getApprovedQuestions('teacher',badItems.map(item=>item.questionId),scope)};
  broken.questionFingerprints=Object.fromEntries(loadRetrievalRows(db,'teacher',scope,['identity-doc'],badItems.map(item=>item.questionId)).map(row=>[row.id,fingerprintRow(row,scope)]));
  db.prepare("UPDATE authoring_chapters SET content_json=? WHERE id=?").run(JSON.stringify(broken),structureChapter.id);
  assert.throws(()=>approveAuthoringChapter('teacher',scope,usable.id,structureChapter.id,structureChapter.revision,''),/选项编号重复/);
  db.prepare("UPDATE authoring_chapters SET status='approved' WHERE project_id=?").run(usable.id);
  db.prepare("UPDATE authoring_projects SET status='completed' WHERE id=?").run(usable.id);
  assert.throws(()=>readyAuthoringProject('teacher',scope,usable.id),/选项编号重复/);
  const repaired=await editAuthoringChapter('teacher',scope,usable.id,structureChapter.id,structureChapter.revision,structureChapter.content);
  assert.equal(repaired.chapters[0].status,'needs_review');
  assert.deepEqual(repaired.workCoverage!.structureProblemQuestionIds,[]);
  assert.equal(repaired.chapters[0].content!.review.passed,false,'replacement requires a new review');
  db.prepare("UPDATE authoring_projects SET status='paused' WHERE status='generating'").run();
  rejectProgression=true;const progressionProject=await create();await kickAuthoringChapters();rejectProgression=false;
  const progressionChapter=read(progressionProject.id).chapters[0];
  assert.equal(progressionChapter.status,'needs_review');
  assert.ok(progressionChapter.content!.review.issues.some(issue=>issue.includes('curriculum.progression')));
  assert.throws(()=>approveAuthoringChapter('teacher',scope,progressionProject.id,progressionChapter.id,progressionChapter.revision,''),/核对/);
  assert.deepEqual(courseStages,new Set(['select','write','review','revise']));
  console.log("chapter workflow passed: course context and progression review, selection, answer review, structure exclusion and legacy repair, identity-aware cross-chapter filtering and supply, teacher edits, recovery, publication, source freshness and leases");
} finally { globalThis.fetch = originalFetch; db.close(); }
