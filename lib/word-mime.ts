export const MAX_WORD_BYTES = 60 * 1024 * 1024;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOC_MIME = "application/msword";

export function isWordDocument(mimeType: string | null | undefined) {
  return mimeType === DOCX_MIME || mimeType === DOC_MIME;
}

/** What the teacher needs to know about how faithfully a Word paper was read. */
export type WordImportSummary = {
  formulas: number;
  mathtype: number;
  omml: number;
  reviewFormulas: number;
  images: number;
  imagesUnreadable: number;
  textBoxes: number;
  warnings: string[];
  /** Formulas embedded as pictures (papers converted from PDF): read from the page, not exact. */
  formulaImages?: number;
  /** "positioned": pictures placed at page coordinates, so pages use the paper's own layout. */
  layout?: "flow" | "positioned";
  convertedFromDoc?: boolean;
};

export function describeWordSummary(summary: WordImportSummary) {
  const parts: string[] = [];
  if (summary.convertedFromDoc) parts.push("旧版 .doc 已自动转换");
  if (summary.layout === "positioned") {
    parts.push("该卷的公式和图片按页面坐标排布（多由 PDF 转成 Word），已按原版式识别，公式需逐题核对");
  } else if (summary.formulas) {
    parts.push(`从 Word 直接读取公式 ${summary.formulas} 个（MathType ${summary.mathtype}、Word 公式 ${summary.omml}）`);
    parts.push(summary.reviewFormulas ? `其中 ${summary.reviewFormulas} 个未能可靠转换，已按页面图片识别并在对应题目标记待核对` : "全部按结构精确转换");
  }
  // A couple of small pictures in a MathType paper are usually logos or symbols, not formulas.
  const formulaImages = summary.formulaImages ?? 0;
  if (summary.layout !== "positioned" && (formulaImages >= 5 || (formulaImages && !summary.formulas))) {
    parts.push(`${formulaImages} 处公式是图片，已按页面识别，需重点核对`);
  }
  if (!summary.formulas && !summary.formulaImages && summary.layout !== "positioned") parts.push("未发现公式");
  if (summary.images && summary.layout !== "positioned") parts.push(`图片 ${summary.images} 张`);
  if (summary.imagesUnreadable) parts.push(`${summary.imagesUnreadable} 张图片无法读取，需对照原卷补图`);
  if (summary.textBoxes) parts.push(`含 ${summary.textBoxes} 个文本框，其中文字请对照原卷核对`);
  return parts.join("；") + "。";
}
