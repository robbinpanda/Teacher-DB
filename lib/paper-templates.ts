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
  style?: PaperStyleConfig;
  sections: PaperTemplateSection[];
};

export type PaperStyleConfig = {
  pageSize: "A4" | "A3";
  orientation: "portrait" | "landscape";
  columns: 1 | 2;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  bodyFont: string;
  bodySize: number;
  lineHeight: number;
  letterSpacing: number;
  titleFont: string;
  titleSize: number;
  titleWeight: 400 | 500 | 700;
  titleLetterSpacing: number;
  titleLineHeight: number;
  titleMarginBottom: number;
  titleItalic: boolean;
  titleUnderline: boolean;
  subtitleSize: number;
  subtitleWeight: 400 | 500 | 700;
  subtitleLetterSpacing: number;
  sectionTitleSize: number;
  sectionTitleWeight: 400 | 500 | 700;
  sectionHeadingGap: number;
  sectionHeadingPadding: number;
  sectionDivider: "none" | "single";
  titleAlign: "left" | "center" | "right";
  headerStyle: "exam" | "classic" | "minimal" | "none";
  headerDivider: "none" | "single" | "double";
  headerBottomSpacing: number;
  headerLabel: string;
  infoStyle: "line" | "boxed";
  candidateInfoSize: number;
  candidateInfoGap: number;
  noticeStyle: "boxed" | "plain" | "hidden";
  noticeMarginTop: number;
  noticeMarginBottom: number;
  showBindingLine: boolean;
  bindingText: string;
  questionGap: number;
  sectionGap: number;
  questionNumberStyle: "decimal" | "parenthesized" | "chinese";
  questionNumberSize: number;
  questionIndent: number;
  optionColumns: 1 | 2 | 4;
  scoreStyle: "inline" | "right" | "hidden";
  footerText: string;
  showPageNumber: boolean;
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
  style: PaperStyleConfig;
};

export const defaultPaperStyle: PaperStyleConfig = {
  pageSize: "A4",
  orientation: "portrait",
  columns: 1,
  marginTop: 18,
  marginRight: 18,
  marginBottom: 18,
  marginLeft: 18,
  bodyFont: '"Songti SC", SimSun, serif',
  bodySize: 10.5,
  lineHeight: 1.75,
  letterSpacing: 0,
  titleFont: 'SimSun, "Songti SC", serif',
  titleSize: 20,
  titleWeight: 700,
  titleLetterSpacing: 0.08,
  titleLineHeight: 1.25,
  titleMarginBottom: 2.5,
  titleItalic: false,
  titleUnderline: false,
  subtitleSize: 10.5,
  subtitleWeight: 400,
  subtitleLetterSpacing: 0,
  sectionTitleSize: 12,
  sectionTitleWeight: 700,
  sectionHeadingGap: 3.5,
  sectionHeadingPadding: 1.3,
  sectionDivider: "none",
  titleAlign: "center",
  headerStyle: "classic",
  headerDivider: "none",
  headerBottomSpacing: 4,
  headerLabel: "",
  infoStyle: "line",
  candidateInfoSize: 9.5,
  candidateInfoGap: 6,
  noticeStyle: "boxed",
  noticeMarginTop: 5,
  noticeMarginBottom: 4,
  showBindingLine: false,
  bindingText: "学校__________ 班级__________ 姓名__________ 准考证号__________",
  questionGap: 6,
  sectionGap: 8,
  questionNumberStyle: "decimal",
  questionNumberSize: 10.5,
  questionIndent: 6,
  optionColumns: 4,
  scoreStyle: "right",
  footerText: "拾题 · 教师题库助手生成",
  showPageNumber: true,
};

const examPaperStyle: PaperStyleConfig = {
  ...defaultPaperStyle,
  marginTop: 16,
  marginRight: 17,
  marginBottom: 18,
  marginLeft: 22,
  bodySize: 10.5,
  lineHeight: 1.8,
  titleSize: 22,
  sectionTitleSize: 12.5,
  headerStyle: "exam",
  headerDivider: "none",
  headerLabel: "",
  noticeStyle: "plain",
  showBindingLine: false,
  questionGap: 4,
  sectionGap: 9,
  scoreStyle: "hidden",
  footerText: "",
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
      style: { ...examPaperStyle },
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
      style: { ...examPaperStyle },
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
      style: { ...defaultPaperStyle, headerStyle: "minimal", noticeStyle: "plain", questionGap: 4, sectionGap: 6, showPageNumber: false },
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
      style: { ...defaultPaperStyle, headerStyle: "classic", marginTop: 15, marginBottom: 15, questionGap: 4, sectionGap: 6 },
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

export function questionStemHasAnswerBlank(stem: string) {
  return /_{2,}|＿{2,}|—{3,}|\.{5,}|…{2,}|\\(?:underline|blank)\s*(?:\{|\b)|[（(]\s{2,}[）)]/.test(stem);
}

function numeric(value: unknown, fallback: number, min: number, max: number) {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : fallback;
}

export function normalizePaperStyle(value: unknown): PaperStyleConfig {
  const style = value && typeof value === "object" ? value as Partial<PaperStyleConfig> : {};
  return {
    pageSize: style.pageSize === "A3" ? "A3" : "A4",
    orientation: style.orientation === "landscape" ? "landscape" : "portrait",
    columns: style.columns === 2 ? 2 : 1,
    marginTop: numeric(style.marginTop, defaultPaperStyle.marginTop, 5, 45),
    marginRight: numeric(style.marginRight, defaultPaperStyle.marginRight, 5, 45),
    marginBottom: numeric(style.marginBottom, defaultPaperStyle.marginBottom, 5, 45),
    marginLeft: numeric(style.marginLeft, defaultPaperStyle.marginLeft, 5, 45),
    bodyFont: typeof style.bodyFont === "string" && style.bodyFont.trim() ? style.bodyFont : defaultPaperStyle.bodyFont,
    bodySize: numeric(style.bodySize, defaultPaperStyle.bodySize, 7, 18),
    lineHeight: numeric(style.lineHeight, defaultPaperStyle.lineHeight, 1, 3),
    letterSpacing: numeric(style.letterSpacing, defaultPaperStyle.letterSpacing, -0.1, 0.5),
    titleFont: typeof style.titleFont === "string" && style.titleFont.trim() ? style.titleFont : defaultPaperStyle.titleFont,
    titleSize: numeric(style.titleSize, defaultPaperStyle.titleSize, 12, 42),
    titleWeight: style.titleWeight === 400 || style.titleWeight === 500 ? style.titleWeight : 700,
    titleLetterSpacing: numeric(style.titleLetterSpacing, defaultPaperStyle.titleLetterSpacing, -0.1, 0.5),
    titleLineHeight: numeric(style.titleLineHeight, defaultPaperStyle.titleLineHeight, 0.9, 2.2),
    titleMarginBottom: numeric(style.titleMarginBottom, defaultPaperStyle.titleMarginBottom, 0, 20),
    titleItalic: Boolean(style.titleItalic),
    titleUnderline: Boolean(style.titleUnderline),
    subtitleSize: numeric(style.subtitleSize, defaultPaperStyle.subtitleSize, 7, 20),
    subtitleWeight: style.subtitleWeight === 500 || style.subtitleWeight === 700 ? style.subtitleWeight : 400,
    subtitleLetterSpacing: numeric(style.subtitleLetterSpacing, defaultPaperStyle.subtitleLetterSpacing, -0.1, 0.5),
    sectionTitleSize: numeric(style.sectionTitleSize, defaultPaperStyle.sectionTitleSize, 8, 24),
    sectionTitleWeight: style.sectionTitleWeight === 400 || style.sectionTitleWeight === 500 ? style.sectionTitleWeight : 700,
    sectionHeadingGap: numeric(style.sectionHeadingGap, defaultPaperStyle.sectionHeadingGap, 0, 20),
    sectionHeadingPadding: numeric(style.sectionHeadingPadding, defaultPaperStyle.sectionHeadingPadding, 0, 10),
    sectionDivider: style.sectionDivider === "single" ? "single" : "none",
    titleAlign: style.titleAlign === "left" || style.titleAlign === "right" ? style.titleAlign : "center",
    headerStyle: style.headerStyle === "exam" || style.headerStyle === "minimal" || style.headerStyle === "none" ? style.headerStyle : "classic",
    headerDivider: style.headerDivider === "single" || style.headerDivider === "double" ? style.headerDivider : "none",
    headerBottomSpacing: numeric(style.headerBottomSpacing, defaultPaperStyle.headerBottomSpacing, 0, 20),
    headerLabel: typeof style.headerLabel === "string" ? style.headerLabel.slice(0, 80) : defaultPaperStyle.headerLabel,
    infoStyle: style.infoStyle === "boxed" ? "boxed" : "line",
    candidateInfoSize: numeric(style.candidateInfoSize, defaultPaperStyle.candidateInfoSize, 7, 18),
    candidateInfoGap: numeric(style.candidateInfoGap, defaultPaperStyle.candidateInfoGap, 0, 20),
    noticeStyle: style.noticeStyle === "plain" || style.noticeStyle === "hidden" ? style.noticeStyle : "boxed",
    noticeMarginTop: numeric(style.noticeMarginTop, defaultPaperStyle.noticeMarginTop, 0, 20),
    noticeMarginBottom: numeric(style.noticeMarginBottom, defaultPaperStyle.noticeMarginBottom, 0, 20),
    showBindingLine: Boolean(style.showBindingLine),
    bindingText: typeof style.bindingText === "string" ? style.bindingText.slice(0, 160) : defaultPaperStyle.bindingText,
    questionGap: numeric(style.questionGap, defaultPaperStyle.questionGap, 0, 24),
    sectionGap: numeric(style.sectionGap, defaultPaperStyle.sectionGap, 0, 30),
    questionNumberStyle: style.questionNumberStyle === "parenthesized" || style.questionNumberStyle === "chinese" ? style.questionNumberStyle : "decimal",
    questionNumberSize: numeric(style.questionNumberSize, defaultPaperStyle.questionNumberSize, 7, 20),
    questionIndent: numeric(style.questionIndent, defaultPaperStyle.questionIndent, 3, 20),
    optionColumns: style.optionColumns === 1 || style.optionColumns === 2 ? style.optionColumns : 4,
    scoreStyle: style.scoreStyle === "inline" || style.scoreStyle === "hidden" ? style.scoreStyle : "right",
    footerText: typeof style.footerText === "string" ? style.footerText.slice(0, 120) : defaultPaperStyle.footerText,
    showPageNumber: style.showPageNumber !== false,
  };
}

export function paperStyleFromTemplate(template: PaperTemplate) {
  return normalizePaperStyle(template.config.style);
}

export function paperStyleToLatex(style: PaperStyleConfig) {
  const paper = `${style.pageSize.toLowerCase()}paper`;
  const orientation = style.orientation === "landscape" ? ",landscape" : "";
  const columns = style.columns === 2 ? "\\twocolumn" : "\\onecolumn";
  const baseline = (style.bodySize * style.lineHeight).toFixed(2);
  const titleWeight = style.titleWeight >= 700 ? "\\bfseries" : style.titleWeight >= 500 ? "\\mdseries" : "\\normalfont";
  return [
    "\\documentclass[UTF8]{ctexart}",
    `\\usepackage[${paper}${orientation},top=${style.marginTop}mm,right=${style.marginRight}mm,bottom=${style.marginBottom}mm,left=${style.marginLeft}mm]{geometry}`,
    `\\AtBeginDocument{\\fontsize{${style.bodySize}pt}{${baseline}pt}\\selectfont}`,
    `\\xeCJKsetup{CJKglue=\\hskip ${style.letterSpacing}em}`,
    `\\newcommand{\\papertitlefont}{\\fontsize{${style.titleSize}pt}{${(style.titleSize * style.titleLineHeight).toFixed(2)}pt}\\selectfont${titleWeight}${style.titleItalic ? "\\itshape" : ""}}`,
    `\\newlength{\\papertitlegap}\\setlength{\\papertitlegap}{${style.titleMarginBottom}mm}`,
    style.sectionDivider === "single" ? "\\newcommand{\\papersectionrule}{\\hrule}" : "\\newcommand{\\papersectionrule}{}",
    `\\setlength{\\parskip}{${style.questionGap}mm}`,
    `\\setCJKmainfont{${/simhei|heiti/i.test(style.bodyFont) ? "SimHei" : "SimSun"}}`,
    columns,
  ].join("\n");
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
    style: normalizePaperStyle(value.style ?? fallbackTemplate.config.style),
  };
}
