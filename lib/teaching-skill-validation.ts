export type SkillQuestion = { number: string; stem: string; options: string[]; answer: string; analysis: string; evidence: string; needsHumanReview: boolean };
export type SkillRecognition = { questions: SkillQuestion[]; warnings: string[] };
export type SkillReview = { accurate: boolean; reasonable: boolean; summary: string; issues: Array<{ number: string; field: string; reason: string }> };

function object(content: string) {
  const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型结果必须是 JSON 对象");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number, required = false): string {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new Error("模型文本缺失或过长");
  return value;
}

export function parseSkillRecognition(content: string): SkillRecognition {
  const value = object(content);
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 200) throw new Error("试识别未返回有效题目（最多200题）");
  const numbers = new Set<string>();
  const questions = value.questions.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("题目结构无效");
    const q = raw as Record<string, unknown>;
    const number = text(q.number, 40, true);
    if (numbers.has(number)) throw new Error("试识别存在重复题号，请复核");
    numbers.add(number);
    if (!Array.isArray(q.options) || q.options.length > 20 || typeof q.needsHumanReview !== "boolean") throw new Error("题目选项或复核标记无效");
    return { number, stem: text(q.stem, 16000, true), options: q.options.map(v => text(v, 4000)), answer: text(q.answer, 16000), analysis: text(q.analysis, 24000), evidence: text(q.evidence, 1000, true), needsHumanReview: q.needsHumanReview };
  });
  if (!Array.isArray(value.warnings) || value.warnings.length > 100) throw new Error("缺少试识别警告列表");
  return { questions, warnings: value.warnings.map(v => text(v, 1000)) };
}

export function parseSkillReview(content: string): SkillReview {
  const value = object(content);
  if (typeof value.accurate !== "boolean" || typeof value.reasonable !== "boolean" || !Array.isArray(value.issues) || value.issues.length > 100) throw new Error("模型复核格式不完整");
  return { accurate: value.accurate, reasonable: value.reasonable, summary: text(value.summary, 3000, true), issues: value.issues.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("复核问题无效");
    const issue = raw as Record<string, unknown>;
    return { number: text(issue.number, 40), field: text(issue.field, 80, true), reason: text(issue.reason, 1000, true) };
  }) };
}
