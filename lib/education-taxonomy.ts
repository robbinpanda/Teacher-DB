export const educationStages = [
  { value: "primary", label: "小学", defaultGrade: "六年级" },
  { value: "middle", label: "初中", defaultGrade: "九年级" },
  { value: "high", label: "高中", defaultGrade: "高三" },
] as const;

export type EducationStage = (typeof educationStages)[number]["value"];

export const subjects = ["数学", "语文", "英语", "物理", "化学", "生物", "科学", "历史", "地理", "道德与法治"] as const;
export type EducationSubject = (typeof subjects)[number];

export const gradesByStage: Record<EducationStage, string[]> = {
  primary: ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"],
  middle: ["七年级", "八年级", "九年级"],
  high: ["高一", "高二", "高三"],
};

const commonBySubject: Record<EducationSubject, string[]> = {
  数学: ["数与式", "方程与不等式", "函数", "几何", "统计与概率", "综合应用"],
  语文: ["字词基础", "语言运用", "古诗文", "现代文阅读", "写作", "综合性学习"],
  英语: ["词汇", "语法", "听力", "完形填空", "阅读理解", "写作"],
  物理: ["力学", "热学", "声学", "光学", "电磁学", "实验探究"],
  化学: ["物质构成", "化学用语", "化学反应", "实验探究", "计算", "化学与生活"],
  生物: ["细胞", "生物体结构", "遗传与进化", "稳态与调节", "生态", "实验探究"],
  科学: ["生命科学", "物质科学", "地球与宇宙", "技术与工程", "科学探究"],
  历史: ["中国古代史", "中国近现代史", "世界古代史", "世界近现代史", "史料实证", "综合探究"],
  地理: ["地球与地图", "自然地理", "人文地理", "区域地理", "地理实践力", "综合分析"],
  道德与法治: ["道德修养", "法治观念", "健全人格", "责任意识", "政治认同", "材料分析"],
};

const mathTags: Record<EducationStage, string[]> = {
  primary: ["整数与小数", "分数与百分数", "四则运算", "简易方程", "图形与测量", "位置与方向", "统计图表", "可能性", "解决问题"],
  middle: ["实数", "整式与分式", "一次方程与不等式", "二次方程", "一次函数", "反比例函数", "二次函数", "三角形", "四边形", "圆", "相似", "锐角三角比", "统计", "概率", "几何证明"],
  high: ["集合与逻辑", "函数性质", "指数对数", "三角函数", "平面向量", "数列", "立体几何", "解析几何", "概率统计", "导数", "复数", "计数原理"],
};

const stageSpecific: Partial<Record<EducationSubject, Partial<Record<EducationStage, string[]>>>> = {
  数学: mathTags,
  语文: {
    primary: ["拼音", "识字写字", "词句积累", "古诗积累", "记叙文阅读", "习作"],
    middle: ["文言文阅读", "古诗词鉴赏", "说明文阅读", "议论文阅读", "名著阅读", "记叙文写作"],
    high: ["论述类文本", "文学类文本", "实用类文本", "文言文", "古代诗歌", "语言文字运用", "材料作文"],
  },
  英语: {
    primary: ["字母与语音", "核心词汇", "基础句型", "情景交际", "短文阅读", "看图写话"],
    middle: ["时态语态", "非谓语动词", "从句", "完形填空", "任务型阅读", "书面表达"],
    high: ["语法填空", "完形填空", "阅读理解", "七选五", "应用文写作", "读后续写"],
  },
};

export function stageLabel(stage: EducationStage) {
  return educationStages.find((item) => item.value === stage)?.label ?? "初中";
}

export function stageFromGrade(grade?: string | null): EducationStage {
  if (!grade) return "middle";
  if (/小学|一|二|三|四|五|六/.test(grade) && !/初|高/.test(grade)) return "primary";
  if (/高中|高一|高二|高三/.test(grade)) return "high";
  return "middle";
}

export function presetTags(subject: string, stage: EducationStage) {
  const safeSubject = subjects.includes(subject as EducationSubject) ? subject as EducationSubject : "数学";
  return Array.from(new Set([
    ...commonBySubject[safeSubject],
    ...(stageSpecific[safeSubject]?.[stage] ?? []),
  ]));
}

export function isEducationStage(value: unknown): value is EducationStage {
  return educationStages.some((item) => item.value === value);
}
