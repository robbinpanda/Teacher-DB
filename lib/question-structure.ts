import { comparableQuestionText } from './question-identity.ts';
export type QuestionStructureIssue = { code: string; severity: 'error' | 'notice'; message: string };
type StructureQuestion = { type: string; stem: string; answer: string; options?: Array<{key:string;content:string}>; optionsJson?: string | null };

/** Deterministic structure checks only; this does not solve or certify a question. */
export function inspectQuestionStructure(question: StructureQuestion): QuestionStructureIssue[] {
  const issues: QuestionStructureIssue[] = [];
  const add = (code:string,message:string,severity:'error'|'notice'='error') => issues.push({code,message,severity});
  if (!question.stem.trim()) add('empty-stem','题干为空，请补全原题。');
  let options: unknown = question.options;
  if (options === undefined) { try { options = JSON.parse(question.optionsJson ?? '[]'); } catch { options = null; } }
  if (!Array.isArray(options) || options.some(option => !option || typeof option !== 'object' || typeof option.key !== 'string' || typeof option.content !== 'string')) {
    add('invalid-options','选项数据格式损坏，请重新核对原题。'); return issues;
  }
  if (question.type !== 'single' && question.type !== 'multiple') return issues;
  if (options.length < 2) { add('missing-options','选择题不足两个结构化选项；请核对原卷，将题干或题图中的选项补全后再自动选用。'); return issues; }
  const keys = options.map(option => option.key.normalize('NFKC').trim().toUpperCase());
  if (keys.some(key => !key)) add('empty-option-key','有选项缺少编号。');
  if (new Set(keys).size !== keys.length) add('duplicate-option-key','选项编号重复，答案无法唯一对应，请核对编号。');
  // Only interpret an unambiguous list of option letters. Prose, equations,
  // Roman numerals and other answer conventions remain for teacher/model review.
  const answerText = question.answer.normalize('NFKC').trim().replace(/^(?:参考答案|答案)\s*[:：]\s*/, '');
  const answer = answerText.replace(/\\(?:mathrm|text)\{([A-H\s,，、]+)\}/g, '$1').replace(/[\s$(){}\[\],，、;；]/g, '');
  const answerIsContent = options.some(option => comparableQuestionText(option.content) === comparableQuestionText(answerText));
  if (/^[A-H]+$/.test(answer) && !answerIsContent) {
    if ([...answer].some(key => !keys.includes(key))) add('answer-outside-options','答案包含不存在的选项编号，请核对答案与选项。');
    if (new Set(answer).size !== answer.length) add('repeated-answer-key','答案重复列出同一选项，请核对答案。');
    if (question.type === 'single' && new Set(answer).size > 1) add('single-with-multiple-answers','单选题列出多个答案项，请核对题型或答案。');
    if (question.type === 'multiple' && answer.length === 1) add('multiple-with-one-answer','多选题只列出一个答案项，请核对是否为不定项选择或题型标错。','notice');
  }
  return issues;
}
export function hasQuestionStructureErrors(question: StructureQuestion) {
  return inspectQuestionStructure(question).some(issue => issue.severity === 'error');
}
