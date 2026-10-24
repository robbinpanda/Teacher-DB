import type { EducationScope } from './education-scope.ts';
import { expandKnowledgeIds, knowledgeCatalog } from './knowledge-catalog.ts';
import { matchQuestions, type RetrievalRow } from './knowledge-retrieval.ts';
import { questionIdentityKey } from './question-identity.ts';

/** Planning hints only: suggested labels are not teacher approval or final selection. */
export function authoringSupply(rows: RetrievalRow[], scope: EducationScope, requestedIds: string[]) {
  const catalog = knowledgeCatalog(scope.subject, scope.stage);
  const ids = expandKnowledgeIds(requestedIds, catalog).filter(id => !catalog.some(node => node.parentId === id));
  const byId = new Map(rows.map(row => [row.id, row]));
  const seen = new Set<string>();
  let excludedStructure = 0, duplicates = 0;
  const hits = matchQuestions(rows, scope).hits.filter(hit => {
    if (hit.structureIssues?.some(issue => issue.severity === 'error')) { excludedStructure++; return false; }
    const key = questionIdentityKey(byId.get(hit.id)!);
    if (seen.has(key)) { duplicates++; return false; }
    seen.add(key); return true;
  });
  return {
    eligibleUnique: hits.length, excludedStructure, duplicates,
    unknownDifficulty: hits.filter(hit => !hit.classification).length,
    knowledge: ids.map(id => ({
      id, label: catalog.find(node => node.id === id)!.label,
      difficulties: [1, 2, 3, 4, 5].map(level => {
        const selected = hits.filter(hit => hit.classification?.difficulty === level && hit.classification.knowledge.some(item => item.id === id));
        return { level, confirmed: selected.filter(hit => hit.classificationStatus === 'confirmed').length,
          suggested: selected.filter(hit => hit.classificationStatus === 'suggested').length,
          types: selected.reduce<Record<string, number>>((counts, hit) => { counts[hit.type] = (counts[hit.type] ?? 0) + 1; return counts; }, {}) };
      }),
    })),
    note: '只统计当前范围内结构合格且去除保守重复的题目。各考点可引用同一道题，不能相加当作不同题总数。模型建议、教师确认分别列出；未知或过期难度不计入任何等级。供给不保证数学正确、课程适配或最终可选，仍须逐题比较和审校。',
  };
}
