/** Synthetic pagination fixture only. Never run against the real question bank. */
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ensureDatabase } from "../db/bootstrap.ts";
import { getSqlite } from "../db/index.ts";
import { putFile } from "../lib/file-storage.ts";
import { trigonometryKnowledge } from "../lib/knowledge-catalog.ts";
import { validateAuthoringPlan, validateAuthoringRequest } from "../lib/authoring-plan.ts";
import { getApprovedQuestions } from "../lib/question-repository.ts";
import { fingerprintRow, loadRetrievalRows } from "../lib/knowledge-retrieval.ts";
import type { SavedChapterContent } from "../lib/authoring-content.ts";

const directory = path.resolve(process.env.JIANTI_DATA_DIR ?? "data");
if (directory !== path.resolve(process.env.JIANTI_E2E_DATA_DIR ?? "missing") || !directory.startsWith(path.resolve("tmp") + path.sep)) throw new Error("Synthetic fixture requires an isolated browser test directory");
await ensureDatabase();
const db = getSqlite(), scope = { subject: "数学", stage: "high" as const }, owner = "book-test", now = new Date().toISOString(), id = randomUUID(), doc = randomUUID();
const request = validateAuthoringRequest({ kind: "book", instruction: "排版回归样书：14 章，每章两道例题、四道练习，仅用于长文档渲染验证。", requiredKnowledgeIds: ["math.high.trigonometry"], documentIds: [doc] }, scope);
const plan = validateAuthoringPlan({ title: "三角函数排版回归样书（合成数据）", audience: "排版回归，不用于课堂教学", approach: "本样书用合成正文、题目与图像验证长文档分页、作答空间、章节顺序和学生教师两版输出，不代表教学内容质量已经通过。", estimatedMinutes: 840, assumptions: [],
  chapters: trigonometryKnowledge.map(node => ({ id: node.id.split(".").pop()!, title: node.label, knowledgeIds: [node.id], prerequisites: [], objectives: [node.objective], teachingNotes: "排版验证用合成章节。", slots: [
    { role: "example", knowledgeIds: [node.id], difficulty: 2, type: "answer", count: 2, score: 0, purpose: "验证例题及完整讲解版面" },
    { role: "practice", knowledgeIds: [node.id], difficulty: 3, type: "answer", count: 4, score: 8, purpose: "验证独立练习与半页作答空间" },
  ] })) }, scope, request);
db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES(?,?,'合成排版资料','application/pdf','complete','数学','高三',?,?)").run(doc, owner, now, now);
const ids: string[] = [], insert = db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,?,?,'answer',?,?,?,'approved',1,'{}',?,?)");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="300"><rect width="660" height="300" fill="white"/><path d="M30 150 H640 M60 280 V20" stroke="black" fill="none"/><polyline points="${Array.from({ length: 240 }, (_, i) => `${60 + i * 2.3},${150 - 110 * Math.sin(i * Math.PI / 100)}`).join(" ")}" fill="none" stroke="black" stroke-width="2"/><text x="620" y="172" font-size="18">x</text><text x="38" y="25" font-size="18">y</text></svg>`;
const imageKey = `documents/${doc}/test-curve.png`; await putFile(imageKey, await sharp(Buffer.from(svg)).png().toBuffer());
for (let i = 0; i < 84; i++) {
  const questionId = randomUUID(); ids.push(questionId);
  insert.run(questionId, doc, String(i + 1), `【排版样题 ${i + 1}】观察函数 $f(x)=\\sin(${i + 1}x)$，写出计算过程并说明条件。${i % 6 === 2 ? "本题含示意图，检验题图之后的独立作答区；请结合给出的条件完成推导，不得把图像大小当作已知数量关系。" : ""}`, i % 6 < 2 ? "合成例题答案：按题设条件进行计算。" : `BOOK-PRACTICE-ANSWER-${i + 1}`, "合成解析：先分析题意与定义域，列出所用公式的条件，再逐步计算并验证结论。", now, now);
  if (i % 6 === 2) db.prepare("INSERT INTO question_assets(id,question_id,kind,role,label,crop_key,bbox_json,created_at) VALUES(?,?,'figure','question','排版示意图',?,'{}',?)").run(randomUUID(), questionId, imageKey, now);
}
const questions = await getApprovedQuestions(owner, ids, scope), rows = loadRetrievalRows(db, owner, scope, [doc]);
const fingerprints = new Map(rows.map(row => [row.id, fingerprintRow(row, scope)]));
db.prepare("INSERT INTO authoring_projects(id,owner_id,subject,stage,kind,title,request_json,plan_json,status,created_at,updated_at) VALUES(?,?,'数学','high','book',?,?,?,'completed',?,?)")
  .run(id, owner, plan.title, JSON.stringify(request), JSON.stringify(plan), now, now);
plan.chapters.forEach((chapter, index) => {
  const selected = ids.slice(index * 6, index * 6 + 6);
  const content: SavedChapterContent = {
    introduction: "这是排版回归用章节，主要检验知识正文、公式块、例题解答、题图与作答留白的组合布局。",
    knowledge: [{ id: chapter.knowledgeIds[0], title: chapter.title, explanation: "本段为排版验证用合成文字，不能代替正式教学内容。长教辅需要把定义、公式适用条件、方法步骤和易错点连贯编排；例题应有完整讲解，练习应有充足书写空间。这里通过多段连续文字检查中文换行、公式排版和章节分页是否稳定。",
      formulas: [{ latex: "\\sin^2 x+\\cos^2 x=1", conditions: "此恒等式对任意实数角成立；此处仅作为公式排版样例。" }], method: "本段用于检查方法文字的段间距与换行：先阅读题目条件，再组织书写步骤，最后检查计算结果与适用范围。", misconceptions: [{ mistake: "把排版样书当作完整教学讲义。", correction: "本样书仅验证渲染和分页，真实教学质量需要另行核对。" }] }],
    items: selected.map((questionId, i) => ({ slotIndex: i < 2 ? 0 : 1, questionId, selectionReason: "本合成题用于覆盖长文档中不同版块的打印组合。", teachingExplanation: i < 2 ? "这是合成例题详解，用于检验连续的解题文字能否在当前页正确换行，必要时自然延续到下一页。首先阅读条件并确定目标，接着写出相应的关系式，逐步进行计算，最后回到题目条件核查结果。正式例题应包含真实可靠的推导，这里不对数学教学质量作结论。" : "" })),
    questions: questions.filter(question => selected.includes(question.id)), questionFingerprints: Object.fromEntries(selected.map(id => [id, fingerprints.get(id)!])),
    gaps: [], conclusion: "本章回顾用于检验最后一道练习与小结的分页关系，避免仅有一小段小结占据额外空白页。",
    review: { passed: true, issues: [] }, traceId: "synthetic-pagination-only", teacherApproval: { at: now, note: "合成数据仅用于渲染回归。" },
  };
  db.prepare("INSERT INTO authoring_chapters(id,project_id,position,plan_json,content_json,status,updated_at) VALUES(?,?,?,?,?,'approved',?)")
    .run(randomUUID(), id, index, JSON.stringify(chapter), JSON.stringify(content), now);
});
console.log(JSON.stringify({ id, owner, title: plan.title, chapters: 14, questions: 84, images: 14 })); db.close();
