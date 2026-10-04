export type VariationPlan = {
  objective: string;
  prerequisites: string;
  difficultyRationale: string;
  misconception: string;
  changes: string[];
};

export function parseVariationPlan(content: string, count: number): VariationPlan {
  const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("命题计划格式无效");
  for (const key of ["objective", "prerequisites", "difficultyRationale", "misconception"]) {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 600) throw new Error(`命题计划缺少 ${key}`);
  }
  if (!Array.isArray(value.changes) || value.changes.length !== count + 1 || value.changes.some((text: unknown) => typeof text !== "string" || !text.trim() || text.length > 400)) throw new Error("命题计划必须覆盖每道候选题");
  return { objective: value.objective, prerequisites: value.prerequisites, difficultyRationale: value.difficultyRationale, misconception: value.misconception, changes: value.changes };
}

export type VariationVerification = { index: number; solvable: boolean; answerCorrect: boolean; objectiveAligned: boolean; difficultyAligned: boolean; explanation: string };

export function parseVariationVerification(content: string, count: number): VariationVerification[] {
  const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!Array.isArray(value?.checks) || value.checks.length !== count) throw new Error("最终复核结果数量不符");
  const seen = new Set<number>();
  const checks = value.checks as VariationVerification[];
  for (const check of checks) {
    if (!check || !Number.isInteger(check.index) || check.index < 1 || check.index > count || seen.has(check.index)) throw new Error("最终复核题号无效或重复");
    seen.add(check.index);
    if ([check.solvable, check.answerCorrect, check.objectiveAligned, check.difficultyAligned].some(flag => flag !== true)) throw new Error(`候选 ${check.index} 未通过最终复核：${typeof check.explanation === "string" ? check.explanation.slice(0, 300) : "可解性、答案、目标或难度未确认"}`);
    if (typeof check.explanation !== "string" || !check.explanation.trim() || check.explanation.length > 1000) throw new Error("最终复核缺少依据");
  }
  return checks.sort((a, b) => a.index - b.index);
}
