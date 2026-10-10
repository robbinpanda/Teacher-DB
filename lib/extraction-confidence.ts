/** Model scores are self assessments, not probabilities; known defects impose an upper bound. */
export function extractionConfidence(value: unknown, input: { needsHumanReview?: boolean; missingImages?: boolean; correctedAssets?: boolean } = {}) {
  const numeric = Number(value);
  const score = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  const ceiling = input.missingImages ? 0.5 : input.needsHumanReview || input.correctedAssets ? 0.65 : 1;
  return Math.min(score, ceiling);
}

export const EXTRACTION_CONFIDENCE_PROMPT = "confidence 必须按本题实际证据返回 0～1 的有限数值，没有默认分数。它表示整道题的转录、答案关联及图片处理可靠程度，不只是文字清晰度；不能复制示例或其他题的分数。发现误图、重复图片、归属错误、截断、缺图、漏字或任何不确定时，needsHumanReview=true，confidence 不得超过 0.65；缺图时不得超过 0.5。即使提出了修正，也要保留本次发现问题后的较低评分，等待教师核实。";
