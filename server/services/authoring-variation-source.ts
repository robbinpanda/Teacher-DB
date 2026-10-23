import { createHash } from "node:crypto";
import type { EducationScope } from "../../lib/education-scope";
import type { AuthoringRequest } from "../../lib/authoring-plan";
import type { WholePaperSource } from "../../lib/authoring-variation";
import { getPaperData, getUploadedPaperData, getApprovedQuestions } from "../../lib/question-repository";
import { normalizePaperSettings, scoreForQuestion } from "../../lib/paper-templates";
import { variationSourceSnapshotHash } from "../../lib/variation-workflow";
import { isVariationQuestion } from "../../lib/question-provenance";
import { getSqlite } from "../../db";
import { inspectQuestionStructure } from "../../lib/question-structure";

export async function prepareWholePaperSource(owner: string, scope: EducationScope, request: AuthoringRequest): Promise<WholePaperSource> {
  const source = request.sourcePaperKind === "uploaded" ? await getUploadedPaperData(request.sourcePaperId!, owner) : await getPaperData(request.sourcePaperId!, owner);
  if (!source?.questions.length) throw new Error("原卷不存在或没有题目");
  if (source.questions.length > 100) throw new Error("整卷变式一次最多 100 题，请将大型资料分卷后生成");
  const approved = await getApprovedQuestions(owner, source.questions.map(q => q.id), scope);
  if (approved.length !== source.questions.length || approved.some(q => q.needsHumanReview)) throw new Error("原卷包含未核对或其他学科学段的题目，请先完成原卷审核");
  if (approved.some(isVariationQuestion)) throw new Error("原卷包含已有 AI 变式题，请选择原始试卷，避免多次改写导致考点漂移");
  for (const question of approved) {
    const errors=inspectQuestionStructure(question).filter(issue=>issue.severity==='error');
    if(errors.length)throw new Error(`原第 ${question.number} 题结构需修复：${errors.map(issue=>issue.message).join(' ')}请先核对原题后再创建变式卷。`);
    const answer = question.answer.replace(/[\s,，、;；]/g, "");
    if (/^[A-H]+$/.test(answer) && (question.type === "multiple" && answer.length < 2 || question.type === "single" && answer.length !== 1)) {
      throw new Error(`原第 ${question.number} 题的题型与答案个数不一致，请先核对原题的单选/多选分类后再创建变式卷`);
    }
  }
  const ordered = source.questions.map(q => approved.find(item => item.id === q.id)!);
  const uploadedScores = new Map((getSqlite().prepare("SELECT id,score FROM questions WHERE document_id=?").all(source.id) as Array<{id:string;score:number}>).map(q => [q.id, q.score]));
  const settings = normalizePaperSettings("settings" in source ? source.settings : { ...scope, sections: [{ id: "original", title: "原卷题目", acceptedTypes: ["single", "multiple", "fill", "answer"], defaultScore: 0, scoreDetail: "", questionIds: ordered.map(q => q.id), scoreSequence: ordered.map(q => uploadedScores.get(q.id) ?? 0) }] }, ordered);
  const questions = new Map(approved.map(q => [q.id, q]));
  let position = 0;
  const items = settings.sections.flatMap(section => section.questionIds.map((id, index) => {
    const question = questions.get(id)!;
    position++;
    return { source: question, fingerprint: variationSourceSnapshotHash(question), number: request.sourcePaperKind === "uploaded" ? question.number : settings.questionNumbers?.[id] ?? String(position),
      score: scoreForQuestion(section, index), sectionId: section.id, sectionTitle: section.title };
  }));
  if (items.length !== approved.length || new Set(items.map(item => item.source.id)).size !== approved.length) throw new Error("原卷分组存在遗漏或重复，请先在组卷器中修复");
  const fingerprint = createHash("sha256").update(JSON.stringify(items.map(item => [item.source.id, item.fingerprint, item.number, item.score, item.sectionId, item.sectionTitle]))).digest("hex");
  return { id: source.id, kind: request.sourcePaperKind!, title: source.title, fingerprint, settings, items };
}
