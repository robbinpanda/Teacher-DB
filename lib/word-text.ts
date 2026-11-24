// Pure helpers for Word papers: the processor's parse format, the typeset HTML,
// the model attachment and placeholder restoration. No I/O, so tests import it.
import katex from "katex";
import { z } from "zod";
import { BLANK_LATEX, KATEX_MACROS, prepareLatex } from "./math-format.ts";
import type { ExtractionIssue, Question } from "./types.ts";

const formulaSchema = z.object({
  id: z.string().regex(/^F\d{1,5}$/),
  source: z.enum(["mathtype", "omml", "text_script", "blank"]),
  latex: z.string().max(20000),
  display: z.boolean(),
  status: z.enum(["converted", "review"]),
  problems: z.array(z.string().max(300)).max(50),
  preview: z.string().regex(/^I\d{1,5}$/).nullable(),
});
const assetSchema = z.object({
  id: z.string().regex(/^I\d{1,5}$/),
  role: z.enum(["image", "formula_image", "formula_preview", "object_preview"]),
  mime: z.enum(["image/png", "image/jpeg"]),
  width: z.number().int().min(1).max(50000),
  height: z.number().int().min(1).max(50000),
  displayWidth: z.number().positive().max(5000).nullable().optional(),
  displayHeight: z.number().positive().max(5000).nullable().optional(),
  base64: z.string().max(40_000_000).optional(),
  key: z.string().max(400).optional(),
});
const reportSchema = z.object({
  paragraphs: z.number().int(), tables: z.number().int(), images: z.number().int(),
  imagesUnreadable: z.number().int(), objectPreviews: z.number().int(), numberedParagraphs: z.number().int(),
  textBoxes: z.number().int(), reviewFormulas: z.number().int(),
  formulas: z.record(z.string(), z.object({ converted: z.number().int(), review: z.number().int() })),
  unsupported: z.record(z.string(), z.number().int()),
  warnings: z.array(z.string().max(500)).max(50),
  formulaImages: z.number().int().default(0),
  layout: z.enum(["flow", "positioned"]).default("flow"),
  positionedPictures: z.number().int().default(0),
  convertedFrom: z.string().max(20).nullable().default(null),
});
const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().max(200000) }),
  z.object({ type: z.literal("table"), rows: z.array(z.array(z.string().max(50000)).max(60)).max(500) }),
]);
export const wordParseSchema = z.object({
  version: z.literal(1),
  blocks: z.array(blockSchema).max(20000),
  formulas: z.array(formulaSchema).max(8000),
  assets: z.array(assetSchema).max(1500),
  report: reportSchema,
});
export type WordParse = z.infer<typeof wordParseSchema>;
type WordFormula = WordParse["formulas"][number];
type WordAsset = WordParse["assets"][number];

const TOKEN = /⟦([FI]\d{1,5})⟧/g;

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formulaLatex(formula: WordFormula) {
  return formula.source === "blank" ? BLANK_LATEX : formula.latex;
}

/** Formulas KaTeX cannot typeset become review items, like failed conversions. */
export function checkWordFormulas(parse: WordParse) {
  let renderErrors = 0;
  for (const formula of parse.formulas) {
    if (formula.status !== "converted") continue;
    try {
      katex.renderToString(prepareLatex(formulaLatex(formula), formula.display), { displayMode: formula.display, throwOnError: true, strict: false, macros: KATEX_MACROS });
    } catch (error) {
      formula.status = "review";
      formula.problems = [...formula.problems, `KaTeX: ${error instanceof Error ? error.message.slice(0, 200) : "排版失败"}`];
      renderErrors += 1;
    }
  }
  parse.report.reviewFormulas = parse.formulas.filter(formula => formula.status === "review" && formula.source !== "blank" && formula.source !== "text_script").length;
  return renderErrors;
}

function renderInline(text: string, formulas: Map<string, WordFormula>, assets: Map<string, WordAsset>) {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    html += escapeHtml(text.slice(last, match.index)).replace(/\n/g, "<br>");
    last = match.index! + match[0].length;
    const id = match[1];
    if (id.startsWith("F")) {
      const formula = formulas.get(id);
      if (!formula) continue;
      if (formula.status === "converted") {
        html += katex.renderToString(prepareLatex(formulaLatex(formula), formula.display), { displayMode: formula.display, throwOnError: false, strict: false, macros: KATEX_MACROS, output: "html" });
      } else {
        const preview = formula.preview ? assets.get(formula.preview) : undefined;
        html += preview
          ? `<img class="formula" src="assets/${preview.id}" style="width:${(preview.displayWidth ?? preview.width / 2).toFixed(1)}pt">`
          : `<span class="unreadable">[公式无法读取]</span>`;
      }
    } else {
      const asset = assets.get(id);
      if (asset?.role === "formula_image") html += `<img class="formula" src="assets/${asset.id}" style="width:${(asset.displayWidth ?? asset.width * 0.75).toFixed(1)}pt">`;
      else if (asset) html += `<img class="figure" src="assets/${asset.id}" style="width:${Math.min(480, asset.displayWidth ?? asset.width * 0.75).toFixed(0)}pt">`;
    }
  }
  return html + escapeHtml(text.slice(last)).replace(/\n/g, "<br>");
}

/** A printable A4 page of the parsed paper; assets are referenced as assets/<id>. */
export function wordToHtml(parse: WordParse) {
  const formulas = new Map(parse.formulas.map(formula => [formula.id, formula]));
  const assets = new Map(parse.assets.map(asset => [asset.id, asset]));
  const body = parse.blocks.map(block => block.type === "paragraph"
    ? `<p>${renderInline(block.text, formulas, assets)}</p>`
    : `<table>${block.rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell, formulas, assets)}</td>`).join("")}</tr>`).join("")}</table>`).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="katex/katex.min.css"><style>
@page { size: A4; margin: 16mm 16mm 18mm; }
html { -webkit-print-color-adjust: exact; }
body { margin: 0; font-family: "Times New Roman", "SimSun", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif; font-size: 10.5pt; line-height: 1.8; color: #000; }
p, td { white-space: pre-wrap; }
p { margin: 0 0 3pt; overflow-wrap: anywhere; }
img.figure { display: inline-block; max-width: 100%; max-height: 90mm; object-fit: contain; vertical-align: middle; margin: 2pt 4pt; }
img.formula { vertical-align: middle; }
.unreadable { border: 1px dashed #888; padding: 0 3pt; }
table { border-collapse: collapse; margin: 3pt 0 6pt; max-width: 100%; }
td { border: 0.6pt solid #666; padding: 2pt 6pt; vertical-align: top; }
.katex { font-size: 1.04em; }
.katex-display { margin: 4pt 0; }
</style></head><body>${body}</body></html>`;
}

/** The original wording for the model, with exact formulas locked behind ⟦F⟧ placeholders. */
export function wordModelText(parse: WordParse, maxCharacters = 120000) {
  // Page-positioned papers keep pictures apart from the text flow, so the
  // text alone would misplace them; those papers are read from their pages.
  if (parse.report.layout === "positioned") return null;
  const formulas = new Map(parse.formulas.map(formula => [formula.id, formula]));
  const assets = new Map(parse.assets.map(asset => [asset.id, asset]));
  const used = new Set<string>();
  const inline = (text: string) => text.replace(TOKEN, (_whole, id: string) => {
    if (id.startsWith("I")) return assets.get(id)?.role === "formula_image" ? "⟦式⟧" : "⟦图⟧";
    const formula = formulas.get(id);
    if (!formula) return "";
    if (formula.status !== "converted") return "⟦公式见页面⟧";
    used.add(id);
    return `⟦${id}⟧`;
  });
  const lines = parse.blocks.map(block => block.type === "paragraph" ? inline(block.text)
    : block.rows.map(row => row.map(inline).join(" | ")).join("\n"));
  const table = Array.from(used, id => `${id} = ${formulaLatex(formulas.get(id)!)}`);
  const text = [
    "【Word 原文】下面是从同一份 Word 原卷直接读取的文字，与页面图片内容相同。题干、选项、答案、解析的文字以它为准逐字抄录。",
    "公式已从 Word 精确读取，并用 ⟦F编号⟧ 占位，末尾的公式表给出对应的 LaTeX 供理解题意。输出任何字段时，凡是原文中占位的公式，必须原样写出 ⟦F编号⟧（含方括号），不要改写成 LaTeX、不要增删或合并编号，系统会自动换回精确公式。",
    "⟦公式见页面⟧ 表示该公式未能可靠读取，⟦式⟧ 表示原文以图片形式嵌入的公式或符号，二者都必须按页面图片抄录为 LaTeX，不能写出这两个标记，也不能把 ⟦式⟧ 当作配图。⟦图⟧ 是原文配图的位置，配图仍按页面给出 assets。",
    "-----", ...lines, "-----", "【公式表】", ...table,
  ].join("\n");
  return text.length <= maxCharacters ? text : null;
}

/** Swap ⟦F⟧ placeholders in a streamed question back to the exact LaTeX. */
export function restoreWordFormulas(question: Question, parse: WordParse) {
  const formulas = new Map(parse.formulas.map(formula => [formula.id, formula]));
  const issues: ExtractionIssue[] = [];
  const unknown = new Set<string>();
  const used: string[] = [];
  let reviewMarker = false;
  const replace = (value: string) => {
    let out = "";
    let last = 0;
    for (const match of value.matchAll(/⟦\s*(F\d{1,5}|图|式|公式见页面)\s*⟧/g)) {
      out += value.slice(last, match.index);
      last = match.index! + match[0].length;
      if (match[1] === "公式见页面" || match[1] === "式") reviewMarker = true;
      if (!match[1].startsWith("F")) continue;
      const formula = formulas.get(match[1]);
      if (!formula || formula.status !== "converted") { unknown.add(match[1]); continue; }
      used.push(match[1]);
      // Adjacent formulas must not merge into a "$$" display delimiter.
      if (out.endsWith("$")) out += " ";
      const latex = formulaLatex(formula);
      out += formula.display ? `$$${latex}$$` : `$${latex}$`;
    }
    return out + value.slice(last);
  };
  question.stem = replace(question.stem);
  question.answer = replace(question.answer);
  question.analysis = replace(question.analysis);
  if (question.options) question.options = question.options.map(option => ({ ...option, content: replace(option.content) }));
  if (unknown.size) issues.push({ code: "word_formula_placeholder", kind: "uncertain", message: `模型引用了不存在或未能读取的 Word 公式编号 ${Array.from(unknown).join("、")}，已删除占位，请对照原卷补全公式` });
  if (reviewMarker) issues.push({ code: "word_formula_review", kind: "uncertain", message: "本题含 Word 中无法自动转换的公式，已按页面图片识别，请对照原卷核对" });
  return { issues, used };
}
