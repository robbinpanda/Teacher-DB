import type { ValidatedVariation } from "./question-variations";

export type VariationRevision = { previousCandidate: unknown; allowQuestionChanges?: boolean };

/** Keep the teacher's question fixed when they requested only a solution correction. */
export function assertVariationQuestionUnchanged(previous: ValidatedVariation, current: ValidatedVariation) {
  for (const field of ["stem", "type", "options", "diagram"] as const) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(current[field])) {
      throw new Error(`本次只修正答案与解析，不得修改上一版候选的 ${field}；请保留题干、选项及题图，重新修正完整解答。`);
    }
  }
}
