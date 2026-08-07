import type Database from "better-sqlite3";

export type DocumentIntegrity = {
  pageCount: number;
  storedPageNumbers: number[];
  completedPageNumbers: number[];
  missingPageNumbers: number[];
  unexpectedPageNumbers: number[];
  incompletePageNumbers: number[];
  questionNumbers: number[];
  missingQuestionNumbers: number[];
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
  const questionNumbers = (sqlite.prepare(
    "SELECT number FROM questions WHERE document_id = ? ORDER BY CAST(number AS INTEGER), number",
  ).all(documentId) as Array<{ number: string }>).map((row) => Number(row.number)).filter((value) => Number.isInteger(value) && value > 0);
  const missingPageNumbers = missingPositiveNumbers(storedPageNumbers, document.pageCount);
  const unexpectedPageNumbers = storedPageNumbers.filter((pageNumber) => pageNumber < 1 || pageNumber > document.pageCount);
  const completed = new Set(completedPageNumbers);
  const incompletePageNumbers = storedPageNumbers.filter((pageNumber) => pageNumber >= 1 && pageNumber <= document.pageCount && !completed.has(pageNumber));
  const missingQuestionNumbers = missingPositiveNumbers(questionNumbers);
  const pagesComplete = document.pageCount > 0 && storedPageNumbers.length === document.pageCount
    && missingPageNumbers.length === 0 && unexpectedPageNumbers.length === 0 && incompletePageNumbers.length === 0;
  const questionsComplete = questionNumbers.length > 0 && missingQuestionNumbers.length === 0;
  return {
    pageCount: document.pageCount,
    storedPageNumbers,
    completedPageNumbers,
    missingPageNumbers,
    unexpectedPageNumbers,
    incompletePageNumbers,
    questionNumbers,
    missingQuestionNumbers,
    pagesComplete,
    questionsComplete,
    reviewReady: pagesComplete && questionsComplete,
  };
}

export function integrityError(integrity: DocumentIntegrity) {
  if (integrity.missingPageNumbers.length) return `原卷缺少第 ${integrity.missingPageNumbers.join("、")} 页，请重新上传同一 PDF 补齐页面`;
  if (integrity.unexpectedPageNumbers.length) return `原卷出现超出声明页数的第 ${integrity.unexpectedPageNumbers.join("、")} 页，请重新上传并核对 PDF`;
  if (integrity.incompletePageNumbers.length) return `第 ${integrity.incompletePageNumbers.join("、")} 页尚未完成识别`;
  if (integrity.missingQuestionNumbers.length) return `识别结果缺少第 ${integrity.missingQuestionNumbers.join("、")} 题，需要补充识别后才能完成审核`;
  if (!integrity.questionNumbers.length) return "还没有可审核的题目";
  return "文档尚未满足审核条件";
}
