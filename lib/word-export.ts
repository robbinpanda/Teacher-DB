/**
 * Build an editable Word (.docx) paper from the same data the PDF export uses.
 *
 * Formulas become Word native equations (see word-math.ts); text stays text,
 * figures stay inline pictures, and the layout follows the paper's template
 * closely enough to print, while staying simple to edit: ordinary paragraphs,
 * tab-aligned options and empty lines for working space.
 *
 * Pure: images are passed in already loaded, so this runs in unit tests.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, ImportedXmlComponent, Packer, PageNumber, PageOrientation,
  Paragraph, SectionType, Tab, TabStopType, TextRun, type ISectionOptions, type ParagraphChild,
} from "docx";
import { analysisImageParts } from "./analysis-images.ts";
import { repairDisplayText, scanMathText, splitMathBlanks, splitOutsideBlanks, unescapeTextLiterals, wrapBareLatex } from "./math-format.ts";
import { questionStemHasAnswerBlank, scoreForQuestion, type PaperSettings, type PaperStyleConfig } from "./paper-templates.ts";
import type { QuestionAsset, QuestionWithSource } from "./types.ts";
import { latexToOmml, type XmlNode } from "./word-math.ts";

export type WordImage = { data: Uint8Array; type: "jpg" | "png" | "gif" | "bmp"; width: number; height: number };

export type WordExportInput = {
  title: string;
  subtitle: string;
  questions: QuestionWithSource[];
  settings: PaperSettings;
  includeAnswers: boolean;
  /** Loaded crops keyed by asset id; assets without an entry are skipped and reported. */
  images: Map<string, WordImage>;
};

export type WordExportResult = {
  bytes: Uint8Array;
  formulas: number;
  /** Question numbers whose formula source KaTeX rejected; kept as `$...$` text in the document. */
  unconvertedFormulas: string[];
  /** Question numbers with a figure that could not be embedded. */
  missingImages: string[];
};

type Inline =
  | { kind: "text"; text: string }
  | { kind: "math"; node: XmlNode; source: string }
  | { kind: "raw"; source: string }
  | { kind: "blank" };
type Line = { display: boolean; inlines: Inline[] };
type Report = { formulas: number; unconverted: boolean; bodySize?: number };

const TWIPS_PER_MM = 1440 / 25.4;
const mm = (value: number) => Math.round(value * TWIPS_PER_MM);
const halfPoints = (points: number) => Math.round(points * 2);
const BLANK_TEXT = "\u00A0".repeat(10);
const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function chineseNumber(value: number) {
  if (value < 10) return chineseDigits[value];
  if (value < 20) return `十${value % 10 ? chineseDigits[value % 10] : ""}`;
  if (value < 100) return `${chineseDigits[Math.floor(value / 10)]}十${value % 10 ? chineseDigits[value % 10] : ""}`;
  return String(value);
}

function questionLabel(value: number, format: PaperStyleConfig["questionNumberStyle"]) {
  if (format === "parenthesized") return `（${value}）`;
  if (format === "chinese") return `${chineseNumber(value)}、`;
  return `${value}. `;
}

/** Template fonts are CSS stacks; Word needs one installed East Asian face. */
function eastAsianFont(stack: string) {
  if (/simhei|heiti|黑体|sans/i.test(stack) && !/serif/i.test(stack.replace(/sans-serif/gi, ""))) return "黑体";
  if (/kaiti|楷/i.test(stack)) return "楷体";
  if (/fangsong|仿宋/i.test(stack)) return "仿宋";
  if (/simhei|heiti|黑体/i.test(stack)) return "黑体";
  return "宋体";
}

function mathInlines(source: string, display: boolean, report: Report): Inline[] {
  return splitMathBlanks(source).map((part): Inline => {
    if (part.type === "blank") return { kind: "blank" };
    report.formulas += 1;
    const node = latexToOmml(part.value, display, report.bodySize);
    if (node) return { kind: "math", node, source: part.value };
    report.unconverted = true;
    return { kind: "raw", source: part.value };
  });
}

/** Split mixed text and LaTeX into lines, following the same rules as the on-screen MathText. */
export function richTextLines(text: string, report: Report = { formulas: 0, unconverted: false }): Line[] {
  const lines: Line[] = [];
  let current: Inline[] = [];
  const flush = () => { if (current.some(item => item.kind !== "text" || item.text.trim())) lines.push({ display: false, inlines: current }); current = []; };
  const pushText = (value: string) => {
    const pieces = value.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) flush();
      if (piece) current.push({ kind: "text", text: piece });
    });
  };
  for (const token of scanMathText(repairDisplayText(text))) {
    if (token.type === "math") {
      const inlines = mathInlines(token.value, token.display, report);
      // A display formula stands on its own line unless it only carries an answer blank.
      if (token.display && inlines.every(item => item.kind === "math")) { flush(); lines.push({ display: true, inlines }); }
      else current.push(...inlines);
      continue;
    }
    for (const part of splitOutsideBlanks(token.value)) {
      if (part.type === "blank") { current.push({ kind: "blank" }); continue; }
      const wrapped = wrapBareLatex(part.value);
      if (wrapped === part.value) { pushText(part.value); continue; }
      for (const inner of scanMathText(wrapped)) {
        if (inner.type === "math") current.push(...mathInlines(inner.value, false, report));
        else pushText(unescapeTextLiterals(inner.value));
      }
    }
  }
  flush();
  return lines;
}

function toComponent(node: XmlNode): ImportedXmlComponent {
  const component = new ImportedXmlComponent(node.name, node.attrs);
  for (const child of node.children) component.push(typeof child === "string" ? child : toComponent(child));
  return component;
}

function inlineChildren(inlines: Inline[], bold = false): ParagraphChild[] {
  return inlines.map((item): ParagraphChild => {
    if (item.kind === "text") return new TextRun({ text: item.text, bold });
    if (item.kind === "blank") return new TextRun({ text: BLANK_TEXT, underline: {} });
    // KaTeX rejected this source. Keep it visible and convertible (MathType: Toggle TeX) rather than dropping it.
    if (item.kind === "raw") return new TextRun({ text: `$${item.source}$`, highlight: "yellow" });
    return toComponent(item.node) as unknown as ParagraphChild;
  });
}

/** Rough width in ems, only used to decide how many options fit on one line. */
function estimatedWidth(inlines: Inline[]) {
  let width = 0;
  for (const item of inlines) {
    if (item.kind === "blank") width += 5;
    else if (item.kind === "text") for (const character of item.text) width += character.charCodeAt(0) > 0x2e7f ? 1 : 0.5;
    else {
      const source = item.source.replace(/\\(?:left|right|dfrac|frac|tfrac|sqrt|vec|overrightarrow|overline|mathrm|mathbf|text|quad|,|;|!)/g, "")
        .replace(/\\[a-zA-Z]+/g, "x").replace(/[{}^_\s]/g, "");
      width += [...source].length * 0.55 + 0.4;
    }
  }
  return width;
}

function imageSize(image: WordImage, scale: number, maximumWidth: number, maximumHeight: number) {
  // The PDF caps figures at 280 CSS px before applying the teacher's scale.
  let width = Math.min(image.width, 280) * (scale / 100);
  let height = width * (image.height / Math.max(1, image.width));
  const shrink = Math.min(1, maximumWidth / width, maximumHeight / height);
  width *= shrink; height *= shrink;
  return { width: Math.max(8, Math.round(width)), height: Math.max(8, Math.round(height)) };
}

export async function buildPaperDocx(input: WordExportInput): Promise<WordExportResult> {
  const { settings, includeAnswers } = input;
  const style = settings.style;
  const dimensions = style.pageSize === "A3" ? [297, 420] : [210, 297];
  const landscape = style.orientation === "landscape";
  const pageWidth = landscape ? dimensions[1] : dimensions[0];
  const columnGap = 8;
  const textWidthMm = (pageWidth - style.marginLeft - style.marginRight - (style.columns === 2 ? columnGap : 0)) / style.columns;
  const textWidthTwips = mm(textWidthMm);
  const textWidthPx = textWidthMm / 25.4 * 96;
  const textWidthEm = textWidthMm / 25.4 * 72 / style.bodySize;
  const bodyFont = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: eastAsianFont(style.bodyFont) };
  const titleFont = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: eastAsianFont(style.titleFont) };
  const lineSpacing = Math.round(240 * Math.min(2.2, Math.max(1, style.lineHeight * 0.85)));
  const alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const;

  const questionMap = new Map(input.questions.map(question => [question.id, question]));
  const unconvertedFormulas: string[] = [];
  const missingImages: string[] = [];
  let formulas = 0;

  const header: Paragraph[] = [];
  if (style.headerStyle === "exam" && style.headerLabel) {
    header.push(new Paragraph({ children: [new TextRun({ text: style.headerLabel, size: halfPoints(style.candidateInfoSize) })] }));
  }
  header.push(new Paragraph({
    alignment: alignment[style.titleAlign],
    spacing: { after: mm(style.titleMarginBottom) },
    children: [new TextRun({
      text: input.title, font: titleFont, size: halfPoints(style.titleSize), bold: style.titleWeight >= 700,
      italics: style.titleItalic, underline: style.titleUnderline ? {} : undefined,
    })],
  }));
  if (input.subtitle) {
    header.push(new Paragraph({
      alignment: alignment[style.titleAlign],
      children: [new TextRun({ text: input.subtitle, size: halfPoints(style.subtitleSize), bold: style.subtitleWeight >= 700 })],
    }));
  }
  if (style.headerStyle !== "none" && settings.infoFields.length) {
    header.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: settings.infoFields.flatMap((field, index) => [
        new TextRun({ text: `${index ? "\u2003" : ""}${field}：`, size: halfPoints(style.candidateInfoSize) }),
        new TextRun({ text: "\u00A0".repeat(14), underline: {}, size: halfPoints(style.candidateInfoSize) }),
      ]),
    }));
  }
  const divider = style.headerDivider === "none" ? undefined
    : { bottom: { style: style.headerDivider === "double" ? BorderStyle.DOUBLE : BorderStyle.SINGLE, size: 6, color: "000000", space: 4 } };
  header.push(new Paragraph({ border: divider, spacing: { after: mm(style.headerBottomSpacing) }, children: [] }));
  if (settings.notice.trim() && style.noticeStyle !== "hidden") {
    const boxed = style.noticeStyle === "boxed";
    const edge = { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 4 };
    const lines = ["注意事项", ...settings.notice.split("\n").filter(line => line.trim())];
    lines.forEach((line, index) => header.push(new Paragraph({
      border: boxed ? { left: edge, right: edge, ...(index === 0 ? { top: edge } : {}), ...(index === lines.length - 1 ? { bottom: edge } : {}) } : undefined,
      spacing: { before: index === 0 ? mm(style.noticeMarginTop) : 0, after: index === lines.length - 1 ? mm(style.noticeMarginBottom) : 0 },
      children: [new TextRun({ text: line, bold: index === 0 })],
    })));
  }

  const body: Paragraph[] = [];
  const figure = (asset: QuestionAsset, number: string, answer: boolean, layoutNumber: number) => {
    const image = input.images.get(asset.id);
    if (!image) { if (!missingImages.includes(number)) missingImages.push(number); return null; }
    const layout = settings.assetLayouts[asset.id];
    const size = imageSize(image, layout?.scale ?? 100, textWidthPx * (answer ? 0.8 : 0.6), 360);
    const description = answer ? asset.label || `第 ${layoutNumber} 题答案图` : layout?.caption || `第 ${layoutNumber} 题的图片`;
    return new Paragraph({
      alignment: answer ? AlignmentType.LEFT : AlignmentType.RIGHT,
      keepLines: true,
      children: [new ImageRun({ type: image.type, data: image.data, transformation: size, altText: { name: description, description, title: description } })],
    });
  };
  const richParagraphs = (text: string, report: Report, options: { prefix?: ParagraphChild[]; suffix?: ParagraphChild[]; keepNext?: boolean } = {}) => {
    const lines = richTextLines(text, report);
    if (!lines.length) lines.push({ display: false, inlines: [] });
    // Prefix and suffix belong to text lines; a leading or trailing display formula gets its own line for them.
    if (options.prefix?.length && lines[0].display) lines.unshift({ display: false, inlines: [] });
    if (options.suffix?.length && lines.at(-1)!.display) lines.push({ display: false, inlines: [] });
    return lines.map((line, index) => new Paragraph({
      alignment: line.display ? AlignmentType.CENTER : undefined,
      keepNext: options.keepNext,
      children: [
        ...(index === 0 ? options.prefix ?? [] : []),
        ...inlineChildren(line.inlines),
        ...(index === lines.length - 1 ? options.suffix ?? [] : []),
      ],
    }));
  };

  let globalIndex = 0;
  for (const section of settings.sections) {
    const sectionQuestions = section.questionIds.map(id => questionMap.get(id)).filter(Boolean) as QuestionWithSource[];
    if (!sectionQuestions.length) continue;
    body.push(new Paragraph({
      keepNext: true,
      spacing: { before: body.length ? mm(style.sectionGap) : 0, after: mm(style.sectionHeadingGap) },
      border: style.sectionDivider === "single" ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 2 } } : undefined,
      children: [
        new TextRun({ text: section.title, bold: style.sectionTitleWeight >= 700, size: halfPoints(style.sectionTitleSize) }),
        ...(section.scoreDetail ? [new TextRun({ text: `\u2002${section.scoreDetail}`, size: halfPoints(style.bodySize) })] : []),
      ],
    }));
    sectionQuestions.forEach((question, sectionIndex) => {
      const questionNumber = ++globalIndex;
      const number = String(questionNumber);
      const report: Report = { formulas: 0, unconverted: false, bodySize: style.bodySize };
      const score = scoreForQuestion(section, sectionIndex);
      const start = body.length;
      const suffix: ParagraphChild[] = [];
      if (question.type === "fill" && !questionStemHasAnswerBlank(question.stem)) suffix.push(new TextRun({ text: BLANK_TEXT, underline: {} }));
      if (score > 0 && style.scoreStyle !== "hidden") suffix.push(new TextRun({ text: `（${score} 分）` }));
      body.push(...richParagraphs(question.stem, report, {
        prefix: [new TextRun({ text: questionLabel(questionNumber, style.questionNumberStyle), size: halfPoints(style.questionNumberSize) })],
        suffix, keepNext: Boolean(question.options?.length) || question.assets.some(asset => asset.role === "question"),
      }));

      const questionAssets = question.assets.filter(asset => asset.role === "question");
      const before = questionAssets.filter(asset => (settings.assetLayouts[asset.id]?.placement ?? "after-stem") === "after-stem");
      const after = questionAssets.filter(asset => settings.assetLayouts[asset.id]?.placement === "before-answer");
      for (const asset of before) { const paragraph = figure(asset, number, false, questionNumber); if (paragraph) body.push(paragraph); }

      if (question.options?.length) {
        const options = question.options.map(option => ({ key: option.key, lines: richTextLines(option.content, report) }));
        const simple = options.every(option => option.lines.length <= 1 && !option.lines[0]?.display);
        const widest = Math.max(0, ...options.map(option => estimatedWidth(option.lines[0]?.inlines ?? []) + 2));
        let columns: number = simple ? style.optionColumns : 1;
        while (columns > 1 && widest > textWidthEm / columns - 1) columns = columns === 4 ? 2 : 1;
        if (columns === 1) {
          for (const option of options) {
            const lines = option.lines.length ? option.lines : [{ display: false, inlines: [] as Inline[] }];
            lines.forEach((line, index) => body.push(new Paragraph({
              alignment: line.display ? AlignmentType.CENTER : undefined,
              children: [...(index === 0 ? [new TextRun({ text: `${option.key}. ` })] : []), ...inlineChildren(line.inlines)],
            })));
          }
        } else {
          const tabStops = Array.from({ length: columns - 1 }, (_, index) => ({ type: TabStopType.LEFT, position: Math.round(textWidthTwips * (index + 1) / columns) }));
          for (let offset = 0; offset < options.length; offset += columns) {
            body.push(new Paragraph({
              tabStops, keepLines: true, keepNext: offset + columns < options.length,
              children: options.slice(offset, offset + columns).flatMap((option, index) => [
                ...(index ? [new TextRun({ children: [new Tab()] })] : []),
                new TextRun({ text: `${option.key}. ` }),
                ...inlineChildren(option.lines[0]?.inlines ?? []),
              ]),
            }));
          }
        }
      }
      for (const asset of after) { const paragraph = figure(asset, number, false, questionNumber); if (paragraph) body.push(paragraph); }

      if (includeAnswers) {
        body.push(...richParagraphs(question.answer || "未录入", report, { prefix: [new TextRun({ text: "答案：", bold: true })] }));
        const answerImages = question.assets.filter(asset => asset.role === "answer");
        let labelled = false;
        const label = () => labelled ? [] : (labelled = true, [new TextRun({ text: "解析：", bold: true })]);
        for (const part of analysisImageParts(question.analysis || "未录入", answerImages.length)) {
          if ("text" in part) { if (part.text.trim()) body.push(...richParagraphs(part.text, report, { prefix: label() })); continue; }
          if (!labelled) body.push(new Paragraph({ children: label() }));
          const paragraph = figure(answerImages[part.image], number, true, questionNumber);
          if (paragraph) body.push(paragraph);
        }
      } else if (question.type === "answer") {
        // Working space as plain empty lines: teachers add or delete lines rather than fight a fixed-height box.
        const configured = settings.answerSpaces[question.id];
        const lineHeightPx = style.bodySize * style.lineHeight * 96 / 72;
        const lines = Number.isFinite(configured) ? Math.min(40, Math.max(0, Math.round(configured / lineHeightPx))) : settings.compact ? 4 : 8;
        for (let index = 0; index < lines; index++) body.push(new Paragraph({ children: [] }));
      }

      formulas += report.formulas;
      if (report.unconverted) unconvertedFormulas.push(number);
      // The gap after a question sits on its last paragraph.
      if (body.length > start) body.push(new Paragraph({ spacing: { line: Math.max(20, mm(style.questionGap) - 20), lineRule: "exact" }, children: [] }));
    });
  }
  if (!input.questions.length) body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "这份试卷还没有题目。" })] }));

  const page = {
    size: { width: mm(dimensions[0]), height: mm(dimensions[1]), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
    margin: { top: mm(style.marginTop), right: mm(style.marginRight), bottom: mm(style.marginBottom), left: mm(style.marginLeft), footer: mm(Math.max(4, style.marginBottom / 2)) },
  };
  // Each page field needs its own run; mixed text and fields in one run are dropped by Word.
  const footerFormat = { size: 18, color: "666666" };
  const footerText = (text: string) => new TextRun({ text, ...footerFormat });
  const footerField = (field: (typeof PageNumber)[keyof typeof PageNumber]) => new TextRun({ children: [field], ...footerFormat });
  const footerRuns: TextRun[] = [];
  if (style.footerText.trim()) footerRuns.push(footerText(style.footerText.trim()));
  if (style.showPageNumber) {
    if (footerRuns.length) footerRuns.push(footerText("    "));
    footerRuns.push(footerText("第 "), footerField(PageNumber.CURRENT), footerText(" 页 共 "), footerField(PageNumber.TOTAL_PAGES), footerText(" 页"));
  }
  const footers = footerRuns.length ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: footerRuns })] }) } : undefined;
  // A two-column paper keeps its title block across the full width, then flows questions in columns.
  const sections: ISectionOptions[] = style.columns === 2
    ? [
        { properties: { page }, footers, children: header },
        { properties: { type: SectionType.CONTINUOUS, page, column: { count: 2, space: mm(columnGap), equalWidth: true } }, footers, children: body },
      ]
    : [{ properties: { page }, footers, children: [...header, ...body] }];

  const document = new Document({
    creator: "拣题",
    title: input.title,
    styles: { default: { document: {
      run: { font: bodyFont, size: halfPoints(style.bodySize) },
      paragraph: { spacing: { line: lineSpacing, lineRule: "auto", before: 0, after: 0 } },
    } } },
    sections,
  });
  return { bytes: new Uint8Array(await Packer.toBuffer(document)), formulas, unconvertedFormulas, missingImages };
}
