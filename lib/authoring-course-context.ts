import { assumedPrerequisites, type AuthoringPlan, type AuthoringRequest } from './authoring-plan.ts';
import { knowledgeCatalog } from './knowledge-catalog.ts';
import type { EducationScope } from './education-scope.ts';
import type { AuthoringReviewCheck } from './authoring-review-checks.ts';

/** A compact course map, not a claim that earlier material has been learned or approved. */
export function authoringCourseContext(plan: AuthoringPlan, chapterId: string, scope: EducationScope) {
  const position = plan.chapters.findIndex(chapter => chapter.id === chapterId);
  if (position < 0) throw new Error('当前章节不在作品大纲中');
  const prior = [...new Set(plan.chapters.slice(0, position).flatMap(chapter => chapter.knowledgeIds))];
  const current = new Set([...prior, ...plan.chapters[position].knowledgeIds]);
  const laterOnly = [...new Set(plan.chapters.slice(position + 1).flatMap(chapter => chapter.knowledgeIds))].filter(id => !current.has(id));
  const assumed = assumedPrerequisites(plan, scope);
  const used = new Set([...plan.chapters.flatMap(chapter => [...chapter.knowledgeIds, ...chapter.prerequisites]), ...assumed.map(item => item.id)]);
  return {
    currentChapterId: chapterId, currentPosition: position + 1, chapterCount: plan.chapters.length,
    priorPlannedKnowledgeIds: prior, laterOnlyKnowledgeIds: laterOnly,
    assumedPrerequisites: assumed,
    assumptions: plan.assumptions,
    knowledge: knowledgeCatalog(scope.subject, scope.stage).filter(node => used.has(node.id)).map(({id,label})=>({id,label})),
    outline: plan.chapters.map((chapter, index) => ({ position: index + 1, id: chapter.id, title: chapter.title,
      knowledgeIds: chapter.knowledgeIds, prerequisites: chapter.prerequisites,
      difficultyRange: [Math.min(...chapter.slots.map(slot=>slot.difficulty)),Math.max(...chapter.slots.map(slot=>slot.difficulty))] })),
  };
}

export const courseContextInstruction = `courseContext 是整份作品的大纲顺序，不代表前章已编写、已采用或学生已经掌握。priorPlannedKnowledgeIds 只是前面计划讲的知识；laterOnlyKnowledgeIds 尚在后章；assumedPrerequisites 是本册未展开的前置假设，须结合教师原始要求和学生基础核对。
选题必须核对整道题（包括全部小问）的主要任务和所需方法，不能因解析提到“单位圆”、背景写“简谐运动”或某一步使用同角关系，就把复数、求导或解三角形综合题当作该基础考点的典型例题。
先依据本章目标选择基础示范，再安排迁移与综合练习。基础章的解法若依赖后章知识或未声明的前置方法，应换题或留下缺口；确属本章目标且能在本章完整解释的必要衔接可以保留，并在选题理由和正文写清。不能用一句“由公式可得”跳过尚未引入的方法，也不能把所有后章考点一概判作不可使用。
保持题目目标、前置要求与难度层次一致；复习试卷或教师明确要求综合训练时按其要求判断，不机械套用新授课顺序。`;

export function courseProgressionChecks(kind: AuthoringRequest['kind']): AuthoringReviewCheck[] {
  return ['handout','book'].includes(kind) ? [{ id:'curriculum.progression', requirement:'结合 courseContext、教师要求和本章实际正文，核对主要考点、全部小问的前置方法和难度递进。基础示范不能由关键词相似的导数、复数等综合题充数；尚在后章且本章未充分讲解的方法不能被当作学生已掌握。明确的综合复习要求、已声明前置或本章充分说明的必要衔接不应误判为错误。大纲顺序不证明前章正文正确或学生已掌握。发现必要前置缺失或教学目标错配时判不通过，并明确需补讲还是换题。' }] : [];
}
