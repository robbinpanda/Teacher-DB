import { presetTags, type EducationStage } from "./education-taxonomy.ts";

export const knowledgeCatalogVersion = "2026-10-24.1";
export type KnowledgeNode = {
  id: string; label: string; parentId: string | null; aliases: string[];
  prerequisites: string[]; objective: string; boundary?: string;
};
export const curriculumSource = {
  title: "普通高中数学课程标准（2017年版2020年修订）",
  url: "https://www.ictr.edu.cn/download_center/put.html",
  scope: "三角函数；平面向量及其应用中的解三角形",
};

const trig = "math.high.trigonometry";
const trigNodes: Array<[string, string, string[], string[], string, string?]> = [
  ["angle", "任意角与弧度制", ["终边相同", "象限角", "角度与弧度", "弧长", "扇形面积"], [], "能表示任意角、互化角度与弧度，并解释弧度的意义。"],
  ["definition", "单位圆与三角函数定义", ["单位圆", "三角函数定义", "终边上的点"], ["angle"], "由单位圆定义正弦、余弦、正切，判断定义域、符号与特殊角值。"],
  ["same-angle", "同角三角函数基本关系", ["同角关系", "平方关系", "商数关系", "同角三角比"], ["definition"], "结合角的范围和符号，用平方关系、商数关系求值与化简。"],
  ["reduction", "诱导公式", ["诱导公式", "诱导关系"], ["definition"], "借助单位圆对称性推导、使用诱导公式，解释符号与函数名变化。"],
  ["graphs", "正弦余弦正切的图象", ["正弦曲线", "正切图象", "余弦图象", "五点作图"], ["definition", "reduction"], "描绘三个基本函数的图象，辨别定义域、值域和正切渐近线。"],
  ["period", "三角函数的周期性", ["最小正周期", "三角函数周期"], ["graphs"], "解释周期并求基本函数、简单复合函数的最小正周期。"],
  ["symmetry", "三角函数的奇偶性与对称性", ["三角函数奇偶性", "三角函数对称轴", "三角函数对称中心"], ["graphs"], "从图象与解析式判断奇偶性、对称轴、对称中心，并检查定义域。"],
  ["monotonicity", "三角函数的单调性", ["三角函数单调区间", "正弦单调", "余弦单调", "正切单调"], ["graphs"], "把复合角的范围映射到基本单调区间，正确处理参数符号。"],
  ["extrema", "三角函数的值域与最值", ["三角函数最值", "三角函数值域", "正弦最值"], ["graphs", "monotonicity"], "在给定区间求值域与最值，检查端点和能否取得极值。"],
  ["parameters", "三角函数图象变换与参数", ["振幅", "初相", "相位", "图象平移", "图像平移", "伸缩变换", "由图求解析式"], ["period", "symmetry"], "解释 A、ω、φ，分析伸缩平移及顺序，结合图象条件确定解析式。"],
  ["sum", "两角和与差公式", ["两角和", "两角差", "和角公式", "差角公式"], ["same-angle", "reduction"], "推导、选择和差公式进行求值、化简与证明，检查正切公式条件。"],
  ["double", "二倍角公式", ["倍角公式", "二倍角", "降幂", "升幂"], ["sum"], "使用倍角公式及其变形处理求值、恒等变换与降幂。"],
  ["identity", "三角恒等变换的综合应用", ["辅助角", "和差化积", "积化和差", "半角公式", "三角恒等变换"], ["sum", "double"], "根据目标选择公式与变形方向，并与函数性质结合。", "积化和差、和差化积、半角公式侧重推导和应用，不标为课标要求背诵的公式。"],
  ["model", "周期现象与三角函数模型", ["周期模型", "三角函数模型", "潮汐", "简谐运动", "周期现象"], ["parameters", "extrema"], "从实际情境选择周期模型，解释参数、定义域和结果的实际意义。"],
];
export const trigonometryKnowledge: KnowledgeNode[] = trigNodes.map(([key, label, aliases, prerequisites, objective, boundary]) => ({
  id: `${trig}.${key}`, label, aliases, parentId: trig, prerequisites: prerequisites.map(id => `${trig}.${id}`), objective, boundary,
}));
const triangleNodes: KnowledgeNode[] = [
  { id: "math.high.triangle.sine", label: "正弦定理", parentId: "math.high.triangle", aliases: ["正弦定理", "边角互化"], prerequisites: [`${trig}.definition`], objective: "运用正弦定理求解边角并讨论解的个数。" },
  { id: "math.high.triangle.cosine", label: "余弦定理", parentId: "math.high.triangle", aliases: ["余弦定理"], prerequisites: [`${trig}.same-angle`], objective: "运用余弦定理求边角、判断三角形形状。" },
  { id: "math.high.triangle.application", label: "解三角形与测量应用", parentId: "math.high.triangle", aliases: ["解三角形", "三角形面积", "测量距离", "仰角", "俯角"], prerequisites: ["math.high.triangle.sine", "math.high.triangle.cosine"], objective: "结合面积和边角条件进行推理，建立实际测量模型。" },
];

export function knowledgeCatalog(subject: string, stage: EducationStage): KnowledgeNode[] {
  const roots = presetTags(subject, stage).map(label => ({ id: `topic.${subject}.${stage}.${label}`, label, parentId: null, aliases: [] as string[], prerequisites: [] as string[], objective: `围绕${label}组织概念、方法和应用。` }));
  if (subject !== "数学" || stage !== "high") return roots;
  return [...roots.filter(node => node.label !== "三角函数"),
    { id: trig, label: "三角函数", parentId: null, aliases: ["三角函数综合"], prerequisites: [], objective: "从单位圆、公式和图象到性质分析与周期建模。" },
    ...trigonometryKnowledge,
    { id: "math.high.triangle", label: "解三角形", parentId: null, aliases: [], prerequisites: [], objective: "用边角关系解决几何和测量问题。" }, ...triangleNodes];
}

/** A parent match expands its descendants; a leaf never expands its siblings. */
export function expandKnowledgeIds(ids: string[], nodes: KnowledgeNode[]) {
  const selected = new Set(ids);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes) if (node.parentId && selected.has(node.parentId) && !selected.has(node.id)) { selected.add(node.id); changed = true; }
  }
  return [...selected];
}

export function resolveKnowledgeTerms(query: string, nodes: KnowledgeNode[]) {
  const normalized = query.normalize("NFKC").replace(/图像/g, "图象");
  const spans = nodes.flatMap(node => [node.label, ...node.aliases].flatMap(raw => {
    const term = raw.replace(/图像/g, "图象"), positions = [];
    for (let start = normalized.indexOf(term); start !== -1; start = normalized.indexOf(term, start + 1)) positions.push({ id: node.id, start, end: start + term.length });
    return positions;
  }));
  const specific = spans.filter(span => !spans.some(other => other.id !== span.id && other.start <= span.start && other.end >= span.end && other.end - other.start > span.end - span.start));
  const matches = nodes.filter(node => specific.some(span => span.id === node.id));
  // If a specific leaf matches, a generic word within it must not broaden retrieval.
  return matches.filter(node => !matches.some(child => child.parentId === node.id)).map(node => node.id);
}

export const questionMethods = ["定义法", "公式变形", "数形结合", "分类讨论", "换元", "方程思想", "函数思想", "反证法", "构造法", "建模", "特殊值", "归纳推理", "坐标法", "向量法", "其他"] as const;
export const questionCompetencies = ["概念理解", "数学运算", "逻辑推理", "直观想象", "数学建模", "数据分析", "综合应用"] as const;
export const difficultyLabels = ["", "基础辨认", "直接应用", "方法迁移", "综合推理", "拓展探究"];
