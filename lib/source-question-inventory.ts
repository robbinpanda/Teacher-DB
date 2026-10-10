export type SourceTextRow = { page: number; text: string };
export type SourceQuestionInventory = {
  source: "pdf-text-corroborated";
  questionCount: number;
  questions: Array<{ number: string; firstLinePage: number; evidence: string }>;
  answers: Array<{ number: string; firstLinePage: number; evidence: string }>;
};

/** Only use a count corroborated independently by the question and answer sections. */
export function corroborateSourceQuestionInventory(rows: SourceTextRow[], pageCount: number): SourceQuestionInventory | null {
  const covered = new Set(rows.filter(row => row.text.trim() && !/^第\s*\d+\s*页/.test(row.text.trim())).map(row => row.page));
  if (covered.size !== pageCount) return null; // A scanned/empty page may hide another question.
  const boundaries = rows.flatMap((row, index) => /^参考答案[与及和]试题解析$/.test(row.text.replace(/\s/g, "")) ? [index] : []);
  if (boundaries.length !== 1) return null;
  const collect = (section: SourceTextRow[]) => {
    const questions: SourceQuestionInventory["questions"] = [];
    for (const row of section) {
      const text = row.text.trim();
      if (!/^\d+\s*[．.、]/.test(text)) continue;
      const match = text.match(/^([1-9]\d{0,2})\s*[．.、]\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]/);
      if (!match) return null; // Mixed numbering/score formats are not authoritative evidence.
      questions.push({ number: match[1], firstLinePage: row.page, evidence: text.slice(0, 160) });
    }
    if (!questions.length || questions.some((question, index) => question.number !== String(index + 1))) return null;
    return questions;
  };
  const questions = collect(rows.slice(0, boundaries[0]));
  const answers = collect(rows.slice(boundaries[0] + 1));
  if (!questions || !answers || questions.length !== answers.length) return null;
  return { source: "pdf-text-corroborated", questionCount: questions.length, questions, answers };
}

export async function readSourceQuestionInventory(bytes: Uint8Array, pageCount: number) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  try {
    const document = await task.promise;
    if (document.numPages !== pageCount) return null;
    const rows: SourceTextRow[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const y = Math.round(item.transform[5]);
        const line = lines.get(y) ?? [];
        line.push({ x: item.transform[4], text: item.str });
        lines.set(y, line);
      }
      rows.push(...Array.from(lines).sort(([left], [right]) => right - left)
        .map(([, line]) => ({ page: pageNumber, text: line.sort((left, right) => left.x - right.x).map(item => item.text).join("") })));
      page.cleanup();
    }
    return corroborateSourceQuestionInventory(rows, pageCount);
  } finally { await task.destroy(); }
}

export function validateExtractionQuestionNumbers(questionTotal: number, numbers: string[]) {
  const actual = new Set(numbers);
  const missing = Array.from({ length: questionTotal }, (_, index) => String(index + 1)).filter(number => !actual.has(number));
  const unexpected = numbers.filter(number => !/^[1-9]\d*$/.test(number) || Number(number) > questionTotal);
  if (missing.length || unexpected.length || actual.size !== numbers.length || numbers.length !== questionTotal) {
    throw new Error(`题数校验失败：预期 ${questionTotal} 题，实际返回 ${numbers.length} 题；缺少第 ${missing.join("、") || "无"} 题；多出或非法题号 ${unexpected.join("、") || "无"}`);
  }
}
