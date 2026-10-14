import type Database from "better-sqlite3";

function isValidQuestionNumber(number: string) {
  return /^[1-9]\d*$/.test(number);
}

export type DocumentIntegrity = {
  pageCount: number;
  storedPageNumbers: number[];
  completedPageNumbers: number[];
  missingPageNumbers: number[];
  unexpectedPageNumbers: number[];
  incompletePageNumbers: number[];
  questionNumbers: number[];
  invalidQuestionNumbers: string[];
  missingQuestionNumbers: number[];
  emptyQuestionNumbers: string[];
  pagesComplete: boolean;
  questionsComplete: boolean;
  reviewReady: boolean;
};

export function missingPositiveNumbers(values: Array<number | string>, expectedMaximum?: number) {
  const numbers = Array.from(new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))).sort((a, b) => a - b);
  const maximum = expectedMaximum ?? numbers.at(-1) ?? 0;
  const present = new Set(numbers);
  return Array.from({ length: maximum }, (_, index) => index + 1).filter((value) => !present.has(value));
}

export function getDocumentIntegrity(sqlite: Database.Database, documentId: string): DocumentIntegrity | null {
  const document = sqlite.prepare("SELECT page_count AS pageCount FROM documents WHERE id = ?").get(documentId) as { pageCount: number } | undefined;
  if (!document) return null;
  const storedPageNumbers = (sqlite.prepare(
    "SELECT page_number AS pageNumber FROM pages WHERE document_id = ? ORDER BY page_number",
  ).all(documentId) as Array<{ pageNumber: number }>).map((row) => row.pageNumber);
  const completedPageNumbers = (sqlite.prepare(
    `SELECT DISTINCT page_number AS pageNumber FROM extraction_runs
      WHERE document_id = ? AND status = 'complete' ORDER BY page_number`,
  ).all(documentId) as Array<{ pageNumber: number }>).map((row) => row.pageNumber);
  const questionRows = sqlite.prepare(
    "SELECT number, stem FROM questions WHERE document_id = ? ORDER BY CAST(number AS INTEGER), number",
  ).all(documentId) as Array<{ number: string; stem: string }>;
  const rawQuestionNumbers = questionRows.map(row => row.number);
  const emptyQuestionNumbers = questionRows.filter(row => !row.stem.trim()).map(row => row.number);
  const invalidQuestionNumbers = rawQuestionNumbers.filter((number) => !isValidQuestionNumber(number));
  const questionNumbers = rawQuestionNumbers.filter(isValidQuestionNumber).map(Number);
  const missingPageNumbers = missingPositiveNumbers(storedPageNumbers, document.pageCount);
  const unexpectedPageNumbers = storedPageNumbers.filter((pageNumber) => pageNumber < 1 || pageNumber > document.pageCount);
  const completed = new Set(completedPageNumbers);
  const incompletePageNumbers = storedPageNumbers.filter((pageNumber) => pageNumber >= 1 && pageNumber <= document.pageCount && !completed.has(pageNumber));
  const missingQuestionNumbers = missingPositiveNumbers(questionNumbers);
  const pagesComplete = document.pageCount > 0 && storedPageNumbers.length === document.pageCount
    && missingPageNumbers.length === 0 && unexpectedPageNumbers.length === 0 && incompletePageNumbers.length === 0;
  const questionsComplete = questionNumbers.length > 0 && missingQuestionNumbers.length === 0 && invalidQuestionNumbers.length === 0 && emptyQuestionNumbers.length === 0;
  return {
    pageCount: document.pageCount,
    storedPageNumbers,
    completedPageNumbers,
    missingPageNumbers,
    unexpectedPageNumbers,
    incompletePageNumbers,
    questionNumbers,
    invalidQuestionNumbers,
    missingQuestionNumbers,
    emptyQuestionNumbers,
    pagesComplete,
    questionsComplete,
    reviewReady: pagesComplete && questionsComplete,
  };
}

export function integrityError(integrity: DocumentIntegrity) {
  if (integrity.emptyQuestionNumbers.length) return `第 ${integrity.emptyQuestionNumbers.join("、")} 题题干为空，需要重新识别或补录，不能入库`;
  if (integrity.missingPageNumbers.length) return `原卷缺少第 ${integrity.missingPageNumbers.join("、")} 页，请重新上传同一 PDF 补齐页面`;
  if (integrity.unexpectedPageNumbers.length) return `原卷出现超出声明页数的第 ${integrity.unexpectedPageNumbers.join("、")} 页，请重新上传并核对 PDF`;
  if (integrity.incompletePageNumbers.length) return `第 ${integrity.incompletePageNumbers.join("、")} 页尚未完成识别`;
  if (integrity.invalidQuestionNumbers.length) return `存在非法题号 ${integrity.invalidQuestionNumbers.join("、")}，题号必须是从 1 开始的阿拉伯数字`;
  if (integrity.missingQuestionNumbers.length) return `识别结果缺少第 ${integrity.missingQuestionNumbers.join("、")} 题，需要补充识别后才能完成审核`;
  if (!integrity.questionNumbers.length) return "还没有可审核的题目";
  return "文档尚未满足审核条件";
}
