export type ScoreItem = { questionId: string; maxScore: number };

export class AssignmentClosedError extends Error {
  constructor() {
    super("作业已结束，请先重新开放后再修改成绩");
    this.name = "AssignmentClosedError";
  }
}

export function normalizeAssignmentScores(items: ScoreItem[], input: Record<string, unknown>) {
  return items.map((item, index) => {
    const value = Object.hasOwn(input, item.questionId) ? input[item.questionId] : undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > item.maxScore) {
      throw new Error(`第 ${index + 1} 题得分应为 0–${item.maxScore} 之间的数值，请完整录入`);
    }
    return { ...item, score: Math.round(value * 100) / 100 };
  });
}

export function parseScoreEntries(items: ScoreItem[], entries: Record<string, string>) {
  const values = Object.fromEntries(items.map((item, index) => {
    const entry = entries[item.questionId]?.trim();
    if (!entry) throw new Error(`请填写第 ${index + 1} 题得分，零分请明确填写 0`);
    return [item.questionId, Number(entry)];
  }));
  return Object.fromEntries(normalizeAssignmentScores(items, values).map((item) => [item.questionId, item.score]));
}
