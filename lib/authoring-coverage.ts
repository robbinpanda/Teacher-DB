import type { AuthoringPlan, AuthoringRequest } from "./authoring-plan.ts";
import type { AuthoringChapter } from "./authoring-content.ts";
import type { EducationScope } from "./education-scope.ts";
import { expandKnowledgeIds, knowledgeCatalog } from "./knowledge-catalog.ts";
import { questionIdentityKey } from "./question-identity.ts";
import { hasQuestionStructureErrors } from "./question-structure.ts";

/** Maximum matching: a shared question cannot satisfy two quotas. Reassign broad slots to protect narrow ones. */
export function allocateUniqueQuestions(groups: Array<{ count: number; candidates: Array<{ id: string; key: string }> }>) {
  const candidates = groups.map(group => new Map(group.candidates.map(candidate => [candidate.key, candidate.id])));
  const keysByGroup = candidates.map(group => [...group.keys()]);
  const units = groups.flatMap((group, groupIndex) => Array.from({ length: group.count }, () => ({ groupIndex, keys: keysByGroup[groupIndex] })));
  const assigned = new Map<string, number>();
  function place(unit: number, visited: Set<string>): boolean {
    for (const key of units[unit].keys) {
      if (visited.has(key)) continue;
      visited.add(key);
      const previous = assigned.get(key);
      if (previous === undefined || place(previous, visited)) { assigned.set(key, unit); return true; }
    }
    return false;
  }
  const order = units.map((_, index) => index).sort((a, b) => units[a].keys.length - units[b].keys.length || a - b);
  for (const unit of order) place(unit, new Set());
  const result: string[][] = groups.map(() => []);
  for (const [key, unit] of assigned) result[units[unit].groupIndex].push(candidates[units[unit].groupIndex].get(key)!);
  return result;
}

type Role = "example" | "practice" | "assessment";
type Count = { planned: number; selected: number; adopted: number; difficulties: number[] };
export type WorkCoverageRow = { id: string; label: string; written: boolean; adoptedKnowledge: boolean; roles: Record<Role, Count>; complete: boolean };
export type WorkCoverage = { rows: WorkCoverageRow[]; plannedQuestions: number; selectedQuestions: number; adoptedQuestions: number; staleQuestionIds: string[]; duplicateQuestionIds: string[]; structureProblemQuestionIds?:string[]; ready: boolean };

/** Evidence comes from saved content and explicit teacher adoption, never from a heading alone. */
export function inspectWorkCoverage(plan: AuthoringPlan, request: AuthoringRequest, chapters: AuthoringChapter[], scope: EducationScope, staleQuestionIds: string[] = []): WorkCoverage {
  const catalog = knowledgeCatalog(scope.subject, scope.stage), stale = new Set(staleQuestionIds);
  const targetIds = new Set([...expandKnowledgeIds(request.requiredKnowledgeIds, catalog).filter(id => !catalog.some(node => node.parentId === id)), ...plan.chapters.flatMap(chapter => chapter.knowledgeIds)]);
  const roles: Role[] = ["example", "practice", "assessment"];
  const emptyCount = (): Count => ({ planned: 0, selected: 0, adopted: 0, difficulties: [] });
  const rows: WorkCoverageRow[] = catalog.filter(node => targetIds.has(node.id)).map(node => ({ id: node.id, label: node.label, written: false, adoptedKnowledge: false,
    roles: { example: emptyCount(), practice: emptyCount(), assessment: emptyCount() }, complete: false }));
  const seenIds = new Set<string>(), seenStems = new Set<string>(), duplicates: string[] = [];
  const structureProblems = new Set<string>();
  let plannedQuestions = 0, selectedQuestions = 0, adoptedQuestions = 0;
  for (const chapterPlan of plan.chapters) {
    const chapter = chapters.find(chapter => chapter.plan.id === chapterPlan.id), content = chapter?.content;
    const adopted = chapter?.status === "approved" && !!content?.teacherApproval;
    for (const row of rows) if (content?.knowledge.some(knowledge => knowledge.id === row.id && knowledge.explanation.trim().length >= 80)) {
      row.written = true;
      if (adopted) row.adoptedKnowledge = true;
    }
    chapterPlan.slots.forEach((slot, slotIndex) => {
      plannedQuestions += slot.count;
      // A concrete child contributes to its displayed parent; a vague parent never proves every leaf.
      const targets = new Set(slot.knowledgeIds);
      for (const id of slot.knowledgeIds) {
        let parent = catalog.find(node => node.id === id)?.parentId;
        while (parent) { targets.add(parent); parent = catalog.find(node => node.id === parent)?.parentId; }
      }
      for (const row of rows) if (targets.has(row.id)) row.roles[slot.role].planned += slot.count;
      for (const item of content?.items.filter(item => item.slotIndex === slotIndex) ?? []) {
        const question = content!.questions.find(question => question.id === item.questionId);
        if (!question || stale.has(item.questionId)) continue;
        if (hasQuestionStructureErrors(question)) { structureProblems.add(question.id); continue; }
        const stem = questionIdentityKey(question);
        if (seenIds.has(question.id) || seenStems.has(stem)) { duplicates.push(question.id); continue; }
        seenIds.add(question.id); seenStems.add(stem); selectedQuestions++;
        if (adopted) adoptedQuestions++;
        for (const row of rows) if (targets.has(row.id)) {
          const count = row.roles[slot.role]; count.selected++;
          if (!count.difficulties.includes(slot.difficulty)) count.difficulties.push(slot.difficulty);
          if (adopted) count.adopted++;
        }
      }
    });
  }
  const educational = ["handout", "book"].includes(request.kind);
  for (const row of rows) {
    row.complete = roles.every(role => row.roles[role].adopted >= row.roles[role].planned) &&
      (educational ? row.adoptedKnowledge && row.roles.example.planned > 0 && row.roles.practice.planned > 0 : roles.some(role => row.roles[role].planned > 0));
    for (const role of roles) row.roles[role].difficulties.sort((a, b) => a - b);
  }
  return { rows, plannedQuestions, selectedQuestions, adoptedQuestions, staleQuestionIds: [...stale], duplicateQuestionIds: duplicates, structureProblemQuestionIds:[...structureProblems],
    ready: rows.length > 0 && rows.every(row => row.complete) && !stale.size && !duplicates.length && adoptedQuestions === plannedQuestions && chapters.length === plan.chapters.length && chapters.every(chapter => chapter.status === "approved" && !chapter.content?.gaps.length) };
}
