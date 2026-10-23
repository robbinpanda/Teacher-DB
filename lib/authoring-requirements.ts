import { z } from "zod";
import type { AuthoringPlan } from "./authoring-plan.ts";
import type { EducationScope } from "./education-scope.ts";
import { knowledgeCatalog } from "./knowledge-catalog.ts";

const roles = z.array(z.enum(["example", "practice", "assessment"])).max(3).default([]);
const types = z.array(z.enum(["single", "multiple", "fill", "answer"])).max(4).default([]);
export const numericRequirementSchema = z.object({
  metric: z.enum(["questions", "score", "scorePerQuestion", "minutes", "chapters", "knowledgePoints", "percent"]),
  scope: z.enum(["work", "eachChapter", "eachKnowledge"]).default("work"),
  roles, types, levels: z.array(z.number().int().min(1).max(5)).max(5).default([]),
  withinRoles: roles, withinTypes: types,
  operator: z.enum(["eq", "min", "max", "gt", "lt"]), value: z.number().min(0).max(100000),
  evidence: z.string().trim().min(2).max(800),
});
export const authoringRequirementsSchema = z.object({
  numeric: z.array(numericRequirementSchema).max(60),
  knowledge: z.array(z.object({ id: z.string().max(150), evidence: z.string().trim().min(2).max(800) })).max(80),
  questionTypes: z.array(z.object({ types: z.array(z.enum(["single", "multiple", "fill", "answer"])).min(1).max(4), evidence: z.string().trim().min(2).max(800) })).max(4).default([]),
  questions: z.array(z.object({ evidence: z.string().trim().min(2).max(800), question: z.string().trim().min(5).max(500) })).max(10),
  assumptions: z.array(z.string().trim().min(2).max(500)).max(15),
});
export type AuthoringRequirements = z.infer<typeof authoringRequirementsSchema> & { editedByTeacher?: boolean };
export type NumericRequirement = z.infer<typeof numericRequirementSchema>;

function chineseNumber(text: string) {
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  if ([...text].every(character => character in digits)) return Number([...text].map(character => digits[character]).join(""));
  let total = 0, part = 0, digit = 0;
  for (const character of text) {
    if (character in digits) digit = digits[character];
    else if (character === "万") { total += (part + digit || 1) * 10000; part = 0; digit = 0; }
    else if (character in units) { part += (digit || 1) * units[character]; digit = 0; }
  }
  return total + part + digit;
}
const numberPattern = "(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]+)";
function statedNumbers(evidence: string, metric: NumericRequirement["metric"]) {
  const normalized = evidence.normalize("NFKC");
  const values = [...normalized.matchAll(new RegExp(numberPattern, "g"))].map(match => chineseNumber(match[0]));
  if (metric === "minutes") {
    for (const match of normalized.matchAll(new RegExp(`(${numberPattern})\\s*(?:个)?小时(?:\\s*(${numberPattern})\\s*分钟)?`, "g"))) values.push(chineseNumber(match[1]) * 60 + (match[2] ? chineseNumber(match[2]) : 0));
    if (/半(?:个)?小时/.test(normalized)) values.push(30);
    if (/一刻钟/.test(normalized)) values.push(15);
    for (const match of normalized.matchAll(new RegExp(`(${numberPattern})\\s*(?:个)?小时半`, "g"))) values.push(chineseNumber(match[1]) * 60 + 30);
    for (const match of normalized.matchAll(new RegExp(`(${numberPattern})\\s*(?:个)?半小时`, "g"))) values.push(chineseNumber(match[1]) * 60 + 30);
  }
  if (metric === "percent") for (const match of normalized.matchAll(new RegExp(`(${numberPattern})成`, "g"))) values.push(chineseNumber(match[1]) * 10);
  return values;
}

export function parseAuthoringRequirements(value: unknown, scope: EducationScope, instruction: string, editedByTeacher = false): AuthoringRequirements {
  const result = authoringRequirementsSchema.parse(value), catalog = knowledgeCatalog(scope.subject, scope.stage), valid = new Set(catalog.map(node => node.id));
  const issues: string[] = [];
  for (const entry of [...result.numeric, ...result.knowledge, ...result.questions, ...result.questionTypes]) if (!instruction.includes(entry.evidence)) issues.push(`要求依据必须逐字引用教师原文，不能编造或改写：${entry.evidence}`);
  if (result.knowledge.some(item => !valid.has(item.id))) issues.push("识别的知识范围不属于当前学科、学段");
  if (new Set(result.knowledge.map(item => item.id)).size !== result.knowledge.length) issues.push("要求中的知识范围重复");
  const rootOf = (id: string) => {
    let node = catalog.find(node => node.id === id);
    while (node?.parentId) node = catalog.find(parent => parent.id === node!.parentId);
    return node?.id;
  };
  if (!editedByTeacher) for (const item of result.knowledge) {
    const mentionedRoots = new Set(catalog.filter(node => [node.label, ...node.aliases].some(term => term.length >= 2 && item.evidence.includes(term))).map(node => rootOf(node.id)));
    if (mentionedRoots.size && !mentionedRoots.has(rootOf(item.id))) issues.push(`知识范围“${catalog.find(node => node.id === item.id)?.label ?? item.id}”的引用“${item.evidence}”只明确提到其他知识大类，不应擅自扩大范围；删去该项，仅保留明确要求的目录范围`);
  }
  for (const item of result.numeric) {
    if (!editedByTeacher && !statedNumbers(item.evidence, item.metric).some(number => Math.abs(number - item.value) < 1e-6)) issues.push(`数值要求在所引原文中找不到：${item.metric}/${item.scope}=${item.value}，引用“${item.evidence}”。应扩大连续引用片段包含对应数字；不要把推算的总数或建议时长另列为硬性要求`);
    if (item.metric === "percent" && item.value > 100) issues.push("占比不能超过 100%");
    if (["questions", "chapters", "knowledgePoints"].includes(item.metric) && !Number.isInteger(item.value)) issues.push("题量、章节数与考点数必须为整数");
    if (item.metric === "chapters" && item.scope !== "work" || item.metric === "minutes" && item.scope !== "work") issues.push("时长和章节总数只能按整份作品核算，分章课时请在教学要求中说明");
    if (["chapters", "minutes", "knowledgePoints"].includes(item.metric) && (item.roles.length || item.types.length || item.levels.length)) issues.push("时长、章节数与考点数不能附带题目筛选条件");
    if (item.metric !== "percent" && (item.withinRoles.length || item.withinTypes.length)) issues.push(`${item.metric} 引用“${item.evidence}”：仅 percent 可以指定分母筛选条件，其他项目 withinRoles/withinTypes 必须为空数组`);
  }
  const equalities = new Map<string, NumericRequirement>();
  for (const item of result.numeric.filter(item => item.operator === "eq")) {
    const key = JSON.stringify([item.metric, item.scope, ...[item.roles, item.types, item.levels, item.withinRoles, item.withinTypes].map(values => [...values].sort())]);
    const previous = equalities.get(key);
    if (previous && previous.value !== item.value) issues.push(`同一组题目有冲突要求：“${previous.evidence}”=${previous.value} 与“${item.evidence}”=${item.value}。检查是否遗漏了用途、题型或难度筛选；原话确有冲突则放入 questions，不能编造解释`);
    equalities.set(key, item);
  }
  if (issues.length) throw new Error(issues.join("；"));
  return { ...result, ...(editedByTeacher ? { editedByTeacher: true } : {}) };
}

const roleLabels = { example: "例题", practice: "练习", assessment: "检测" }, typeLabels = { single: "单选", multiple: "多选", fill: "填空", answer: "解答" };
export const operatorLabels = { eq: "等于", min: "至少", max: "至多", gt: "大于", lt: "小于" };
export const metricLabels = { questions: "题量", score: "总分", scorePerQuestion: "每题分值", minutes: "用时（分钟）", chapters: "章节数", knowledgePoints: "考点数", percent: "题量占比（%）" };
export function requirementLabel(item: NumericRequirement) {
  return `${({ work: "整份", eachChapter: "每章", eachKnowledge: "每个考点" })[item.scope]} · ${[...item.roles.map(role => roleLabels[role]), ...item.types.map(type => typeLabels[type]), ...(item.levels.length ? [`难度 ${item.levels.join("、")}`] : [])].join("、") || "全部题目"} · ${metricLabels[item.metric]}${item.metric === "percent" && (item.withinRoles.length || item.withinTypes.length) ? `（以${[...item.withinRoles.map(role => roleLabels[role]), ...item.withinTypes.map(type => typeLabels[type])].join("、")}为分母）` : ""}`;
}
export type RequirementCheck = { label: string; evidence: string; expected: string; actual: string; passed: boolean };
export function inspectPlanRequirements(plan: AuthoringPlan, requirements: AuthoringRequirements, scope?: EducationScope): RequirementCheck[] {
  const all = plan.chapters.flatMap(chapter => chapter.slots);
  const catalog = scope ? knowledgeCatalog(scope.subject, scope.stage) : [];
  const checks: RequirementCheck[] = [];
  for (const item of requirements.numeric) {
    const groups = item.scope === "eachChapter" ? plan.chapters.map(chapter => ({ name: chapter.title, slots: chapter.slots, knowledge: chapter.knowledgeIds }))
      : item.scope === "eachKnowledge" ? [...new Set(plan.chapters.flatMap(chapter => chapter.knowledgeIds))].map((id, index) => ({ name: catalog.find(node => node.id === id)?.label ?? `考点 ${index + 1}`, slots: all.filter(slot => slot.knowledgeIds.includes(id)), knowledge: [id] }))
        : [{ name: "整份", slots: all, knowledge: plan.chapters.flatMap(chapter => chapter.knowledgeIds) }];
    const values = groups.flatMap(group => {
      const base = item.metric === "percent" ? group.slots.filter(slot => (!item.withinRoles.length || item.withinRoles.includes(slot.role)) && (!item.withinTypes.length || item.withinTypes.includes(slot.type as NumericRequirement["types"][number]))) : group.slots;
      const selected = base.filter(slot => (!item.roles.length || item.roles.includes(slot.role)) && (!item.types.length || item.types.includes(slot.type as NumericRequirement["types"][number])) && (!item.levels.length || item.levels.includes(slot.difficulty)));
      const total = selected.reduce((sum, slot) => sum + slot.count, 0);
      const denominator = base.reduce((sum, slot) => sum + slot.count, 0);
      const numbers = item.metric === "questions" ? [total] : item.metric === "score" ? [selected.reduce((sum, slot) => sum + slot.count * slot.score, 0)]
        : item.metric === "scorePerQuestion" ? selected.map(slot => slot.score) : item.metric === "minutes" ? [plan.estimatedMinutes]
          : item.metric === "chapters" ? [plan.chapters.length] : item.metric === "knowledgePoints" ? [new Set(group.knowledge).size] : denominator ? [total / denominator * 100] : [];
      return numbers.length ? numbers.map(value => ({ name: group.name, value })) : [{ name: group.name, value: NaN }];
    });
    const passes = (actual: number) => Number.isFinite(actual) && ({ eq: Math.abs(actual - item.value) < 1e-6, min: actual >= item.value, max: actual <= item.value, gt: actual > item.value, lt: actual < item.value })[item.operator];
    checks.push({ label: requirementLabel(item), evidence: item.evidence, expected: `${operatorLabels[item.operator]} ${item.value}`,
      actual: values.map(value => `${value.name}：${Number.isFinite(value.value) ? Number(value.value.toFixed(3)) : "无可计算题目"}`).join("；"), passed: values.length > 0 && values.every(value => passes(value.value)) });
  }
  for (const item of requirements.questionTypes ?? []) {
    const invalid = all.filter(slot => !item.types.includes(slot.type as typeof item.types[number]));
    checks.push({ label: "允许题型", evidence: item.evidence, expected: item.types.map(type => typeLabels[type]).join("、"),
      actual: invalid.length ? `有 ${invalid.reduce((sum, slot) => sum + slot.count, 0)} 道未指定或不符合题型的题` : "全部题目符合限定题型", passed: invalid.length === 0 });
  }
  return checks;
}
export function assertPlanRequirements(plan: AuthoringPlan, requirements: AuthoringRequirements, scope?: EducationScope) {
  if (requirements.questions.length) throw new Error(`教学要求仍需澄清：${requirements.questions.map(item => item.question).join("；")}`);
  const failed = inspectPlanRequirements(plan, requirements, scope).filter(check => !check.passed);
  if (failed.length) throw new Error(`大纲未满足教师要求：${failed.map(check => `${check.label} 应${check.expected}，实际 ${check.actual}`).join("；")}`);
}

export const authoringRequirementsSystemPrompt = `你是教学需求核对员。本轮只读取教师原话，不生成大纲、不看另一模型的大纲。
独立提取明确的数量、题型、分值、时间、知识范围；不得把自己建议的默认值变成教师硬性要求。每项 evidence 必须是教师原文中的连续片段，包含对应数字、单位和限定词。
返回 JSON：{numeric:[{metric:"questions|score|scorePerQuestion|minutes|chapters|knowledgePoints|percent",scope:"work|eachChapter|eachKnowledge",roles:[],types:[],levels:[],withinRoles:[],withinTypes:[],operator:"eq|min|max|gt|lt",value:1,evidence:"原文"}],knowledge:[{id,evidence}],questionTypes:[{types:[],evidence}],questions:[{evidence,question}],assumptions:[]}。
roles 可选 example/practice/assessment；types 可选 single/multiple/fill/answer；空数组表示不限。明确的“选择题”包括 single 与 multiple，不擅自当成只有单选。
questions 是题数，score 是筛选后题目的总分，scorePerQuestion 是每一道题的分值；百分比按题量，百分比的分母可用 withinRoles/withinTypes 限定。minutes 换算为分钟，chapters 为整份章节数，这两个 metric 必须 scope=work、筛选数组为空。
每章/每节的两例四练用 eachChapter；“每个知识点”用 eachKnowledge。“每章只教一个具体考点”是 knowledgePoints/eachChapter/eq/1，绝不是 chapters/work/eq/1。考点数和章节数不能混用。
questionTypes 表达整份题型限制，例如“全部为填空题”=>{types:["fill"],evidence:"全部为填空题"}；“只出选择题”=>single和multiple。没有明确限制则留空。范围上下限分成 min/max；超过用 gt，少于用 lt；不要把“至少”当成恰好。数字可为中文，小时需换算；含糊如“一百多道”不要假装精确，放入 questions 询问。
难度是教学估计：1基础辨认、2直接应用、3方法迁移、4综合推理、5拓展探究。若明确使用基础/中档/提高占比，可分别以 [1,2]/[3]/[4,5] 表示，并在 assumptions 写明映射供教师核对。
knowledge 只能使用给定目录 ID。完整覆盖三角函数等父范围时只用父 ID math.high.trigonometry，后续程序会展开全部叶节点；周期专题只提取 period，不额外加入 graphs、parameters 等前置或相关节点。
questions 只记录真实冲突或无法确定的硬性数值，不能用来重复确认已经明确的原话，不能追问模型可自行决定的教学常规。全是填空题无需再确认；60%基础+40%提高无需追问中档题；按前置知识安排的并列考点顺序可自行决定；知识讲解、适用条件、易错点、难度递进等常规教学要求交给后续大纲落实，最多写入 assumptions，不要因此阻塞规划。
evidence 必须直接复制原文，包括中文数字，绝不改写为阿拉伯数字；“六道单选每题五分”可以同时作为题数6和每题5分的依据。未指定数字不提取默认值，也不要增加通过加减乘除推算的数字约束：两例四练只提取2和4，不再添加每章6题；完整知识范围由 knowledge 表达，不从目录叶节点数推算章节数/总题量。只有小时换算分钟、成数换算百分数允许单位换算。`;
