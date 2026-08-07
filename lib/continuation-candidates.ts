import type Database from "better-sqlite3";
import type { BoundingBox } from "./types";

export type ContinuationCandidate = {
  number: string;
  primaryPage: number;
  lastPage: number;
  stemTail: string;
  analysisTail: string;
};

export function loadContinuationCandidates(sqlite: Database.Database, documentId: string, pageNumber: number): ContinuationCandidate[] {
  if (pageNumber <= 1) return [];
  const rows = sqlite.prepare(
    `SELECT q.number AS number, q.page_number AS primaryPage, q.stem AS stem,
            q.analysis AS analysis, qr.page_number AS lastPage, qr.bbox_json AS regionBbox
       FROM questions q
       JOIN question_regions qr ON qr.question_id = q.id
      WHERE q.document_id = ? AND q.page_number <= ?
        AND qr.page_number BETWEEN ? AND ?
      ORDER BY qr.page_number DESC`,
  ).all(documentId, pageNumber, pageNumber - 1, pageNumber) as Array<{
    number: string;
    primaryPage: number;
    lastPage: number;
    stem: string;
    analysis: string;
    regionBbox: string;
  }>;
  const byNumber = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const current = byNumber.get(row.number);
    if (!current || row.lastPage > current.lastPage) byNumber.set(row.number, row);
  }
  const bottom = (row: typeof rows[number]) => {
    try {
      const box = JSON.parse(row.regionBbox) as BoundingBox;
      return Number(box.y) + Number(box.height);
    } catch { return -1; }
  };
  return Array.from(byNumber.values()).sort((left, right) =>
    right.lastPage - left.lastPage || bottom(right) - bottom(left) || Number(right.number) - Number(left.number),
  ).slice(0, 4).map((row) => ({
    number: row.number,
    primaryPage: row.primaryPage,
    lastPage: row.lastPage,
    stemTail: row.stem.slice(-1400),
    analysisTail: row.analysis.slice(-900),
  }));
}
