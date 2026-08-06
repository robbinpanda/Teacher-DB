import type { EducationStage } from "./education-taxonomy";
import type { QuestionType, QuestionWithSource } from "./types";

export type PaperTemplateSection = {
  id: string;
  title: string;
  scoreDetail: string;
  acceptedTypes: QuestionType[];
  defaultScore: number;
  scoreSequence?: number[];
};

export type PaperTemplateConfig = {
  notice: string;
  infoFields: string[];
  compact: boolean;
  sections: PaperTemplateSection[];
};

export type PaperTemplate = {
  id: string;
  name: string;
  subject: string;
  stage: EducationStage;
  kind: "exam" | "homework" | "quiz" | "custom";
  description: string;
  isPreset: boolean;
  config: PaperTemplateConfig;
};

export type PaperSection = PaperTemplateSection & {
  questionIds: string[];
};

export type PaperAssetLayout = {
  x: number;
  y: number;
  scale: number;
  placement: "before-answer" | "after-stem";
  caption: string;
};

export type PaperSettings = {
  templateId: string;
  subject: string;
  stage: EducationStage;
  showAnswers: boolean;
  answerSpaces: Record<string, number>;
  assetLayouts: Record<string, PaperAssetLayout>;
  sections: PaperSection[];
  notice: string;
  infoFields: string[];
  compact: boolean;
};

export const presetPaperTemplates: PaperTemplate[] = [
  {
    id: "preset-middle-math-exam",
    name: "中考数学标准卷",
    subject: "数学",
    stage: "middle",
    kind: "exam",
    description: "150 分正式试卷，选择、填空、解答三板块。",
    isPreset: true,
    config: {
      notice: "1. 本试卷含三个大题，请在规定区域内作答。\n2. 解答题须写出必要的计算、证明或推理过程。",
      infoFields: ["姓名", "班级", "准考证号"],
      compact: false,
      sections: [
        { id: "choice", title: "一、选择题", scoreDetail: "本大题共 6 题，每题 4 分，满分 24 分", acceptedTypes: ["single", "multiple"], defaultScore: 4 },
        { id: "fill", title: "二、填空题", scoreDetail: "本大题共 12 题，每题 4 分，满分 48 分", acceptedTypes: ["fill"], defaultScore: 4 },
        { id: "answer", title: "三、解答题", scoreDetail: "第 19-22 题每题 10 分，第 23、24 题每题 12 分，第 25 题 14 分，满分 78 分", acceptedTypes: ["answer"], defaultScore: 10, scoreSequence: [10, 10, 10, 10, 12, 12, 14] },
      ],
    },
  },
  {
    id: "preset-high-math-exam",
    name: "高考数学标准卷",
    subject: "数学",
    stage: "high",
    kind: "exam",
    description: "150 分正式试卷，按上海模考常见板块与分值排版。",
    isPreset: true,
    config: {
      notice: "考生应在答题纸相应位置作答；解答题必须写出必要步骤。",
      infoFields: ["姓名", "班级", "准考证号"],
      compact: false,
      sections: [
        { id: "fill", title: "一、填空题", scoreDetail: "共 12 题，满分 54 分；第 1-6 题每题 4 分，第 7-12 题每题 5 分", acceptedTypes: ["fill"], defaultScore: 4, scoreSequence: [4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5] },
        { id: "choice", title: "二、选择题", scoreDetail: "共 4 题，满分 18 分；第 13、14 题每题 4 分，第 15、16 题每题 5 分", acceptedTypes: ["single", "multiple"], defaultScore: 4, scoreSequence: [4, 4, 5, 5] },
        { id: "answer", title: "三、解答题", scoreDetail: "共 5 题，满分 78 分", acceptedTypes: ["answer"], defaultScore: 14, scoreSequence: [14, 14, 14, 18, 18] },
      ],
    },
  },
  {
    id: "preset-homework",
    name: "日常作业",
    subject: "*",
    stage: "middle",
    kind: "homework",
    description: "弱化考试信息，题目紧凑排列并保留作答空间。",
    isPreset: true,
    config: {
      notice: "独立完成，写清必要步骤；订正时请使用不同颜色。",
      infoFields: ["姓名", "日期"],
      compact: true,
      sections: [
        { id: "basic", title: "一、基础练习", scoreDetail: "建议每题 5 分", acceptedTypes: ["single", "multiple", "fill"], defaultScore: 5 },
        { id: "practice", title: "二、综合练习", scoreDetail: "建议每题 10 分", acceptedTypes: ["answer"], defaultScore: 10 },
      ],
    },
  },
  {
    id: "preset-quiz",
    name: "课堂测试",
    subject: "*",
    stage: "middle",
    kind: "quiz",
    description: "适合单元测或随堂测，板块清晰、信息精简。",
    isPreset: true,
    config: {
      notice: "请在规定时间内完成，保持卷面整洁。",
      infoFields: ["姓名", "班级", "得分"],
      compact: true,
      sections: [
        { id: "objective", title: "一、客观题", scoreDetail: "每题 5 分", acceptedTypes: ["single", "multiple", "fill"], defaultScore: 5 },
        { id: "subjective", title: "二、解答题", scoreDetail: "每题 10 分", acceptedTypes: ["answer"], defaultScore: 10 },
      ],
    },
  },
];

export function sectionsFromTemplate(template: PaperTemplate, questions: QuestionWithSource[]): PaperSection[] {
  const assigned = new Set<string>();
  const sections = template.config.sections.map((section) => {
    const questionIds = questions.filter((question) => !assigned.has(question.id) && section.acceptedTypes.includes(question.type)).map((question) => question.id);
    questionIds.forEach((id) => assigned.add(id));
    return { ...section, scoreSequence: section.scoreSequence ? [...section.scoreSequence] : undefined, questionIds };
  });
  const remaining = questions.filter((question) => !assigned.has(question.id)).map((question) => question.id);
  if (remaining.length) sections.at(-1)?.questionIds.push(...remaining);
  return sections;
}

export function scoreForQuestion(section: PaperSection, index: number) {
  return section.scoreSequence?.[index] ?? section.defaultScore;
}

export function defaultAssetLayout(questionNumber: number): PaperAssetLayout {
  return { x: 0, y: 0, scale: 100, placement: "after-stem", caption: `第 ${questionNumber} 题的图片` };
}

export function normalizePaperSettings(value: Record<string, unknown>, questions: QuestionWithSource[]): PaperSettings {
  const fallbackTemplate = presetPaperTemplates.find((template) => template.id === "preset-homework")!;
  const candidateSections = Array.isArray(value.sections) ? value.sections as PaperSection[] : [];
  const knownIds = new Set(questions.map((question) => question.id));
  const sections = candidateSections.length ? candidateSections.map((section) => ({
    ...section,
    acceptedTypes: Array.isArray(section.acceptedTypes) ? section.acceptedTypes : ["single", "multiple", "fill", "answer"] as QuestionType[],
    questionIds: Array.isArray(section.questionIds) ? section.questionIds.filter((id) => knownIds.has(id)) : [],
    defaultScore: Number(section.defaultScore) || 0,
  })) : sectionsFromTemplate(fallbackTemplate, questions);
  const placed = new Set(sections.flatMap((section) => section.questionIds));
  const remaining = questions.filter((question) => !placed.has(question.id)).map((question) => question.id);
  if (remaining.length) sections.at(-1)?.questionIds.push(...remaining);
  return {
    templateId: typeof value.templateId === "string" ? value.templateId : fallbackTemplate.id,
    subject: typeof value.subject === "string" ? value.subject : questions[0]?.source.subject ?? "数学",
    stage: value.stage === "primary" || value.stage === "high" ? value.stage : "middle",
    showAnswers: Boolean(value.showAnswers),
    answerSpaces: value.answerSpaces && typeof value.answerSpaces === "object" ? value.answerSpaces as Record<string, number> : {},
    assetLayouts: value.assetLayouts && typeof value.assetLayouts === "object" ? value.assetLayouts as Record<string, PaperAssetLayout> : {},
    sections,
    notice: typeof value.notice === "string" ? value.notice : fallbackTemplate.config.notice,
    infoFields: Array.isArray(value.infoFields) ? value.infoFields.map(String) : fallbackTemplate.config.infoFields,
    compact: typeof value.compact === "boolean" ? value.compact : fallbackTemplate.config.compact,
  };
}
