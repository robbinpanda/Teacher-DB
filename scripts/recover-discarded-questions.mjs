import { randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const documentId = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!documentId) throw new Error("Usage: node scripts/recover-discarded-questions.mjs <document-id> [--apply]");

const databasePath = path.resolve(process.env.SHITI_DATA_DIR || path.join(process.cwd(), "data"), "teacher-question-bank.sqlite3");
const sqlite = new Database(databasePath, { readonly: !apply, fileMustExist: true });

function safeBox(value) {
  const box = value && typeof value === "object" ? value : {};
  return {
    x: Math.max(0, Math.min(100, Number(box.x) || 0)),
    y: Math.max(0, Math.min(100, Number(box.y) || 0)),
    width: Math.max(0.1, Math.min(100, Number(box.width) || 0.1)),
    height: Math.max(0.1, Math.min(100, Number(box.height) || 0.1)),
  };
}

function resolvePage(rawPage, availablePages, fallbackPage) {
  const page = Number(rawPage ?? fallbackPage);
  if (availablePages.includes(page)) return page;
  if (Number.isInteger(page) && page >= 1 && page <= availablePages.length) return availablePages[page - 1];
  return null;
}

try {
  const document = sqlite.prepare("SELECT id, name FROM documents WHERE id = ?").get(documentId);
  if (!document) throw new Error(`Document not found: ${documentId}`);
  const pages = sqlite.prepare("SELECT id, page_number AS pageNumber FROM pages WHERE document_id = ? ORDER BY page_number").all(documentId);
  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
  const existingNumbers = new Set(sqlite.prepare("SELECT number FROM questions WHERE document_id = ?").all(documentId).map((row) => String(row.number)));
  const runs = sqlite.prepare(
    "SELECT page_number AS pageNumber, raw_json AS rawJson FROM extraction_runs WHERE document_id = ? AND status = 'complete' AND raw_json IS NOT NULL ORDER BY page_number",
  ).all(documentId);
  const candidates = new Map();

  for (const run of runs) {
    let raw;
    try { raw = JSON.parse(run.rawJson); } catch { continue; }
    const availablePages = [run.pageNumber, run.pageNumber + 1].filter((pageNumber) => pageByNumber.has(pageNumber));
    for (const item of Array.isArray(raw.questions) ? raw.questions : []) {
      const number = String(item?.number ?? "").trim();
      if (!/^[1-9]\d*$/.test(number) || existingNumbers.has(number)) continue;
      const regions = (Array.isArray(item.regions) ? item.regions : []).map((region) => {
        const pageNumber = resolvePage(region?.page, availablePages, run.pageNumber);
        return pageNumber ? { pageNumber, bbox: safeBox(region?.bbox) } : null;
      }).filter(Boolean).filter((region, index, all) => all.findIndex((candidate) => candidate.pageNumber === region.pageNumber) === index);
      if (!regions.length) continue;
      const primaryRegion = regions.find((region) => region.pageNumber === run.pageNumber) ?? regions[0];
      const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0));
      const candidate = {
        number,
        type: ["single", "multiple", "fill", "answer"].includes(String(item.type)) ? String(item.type) : "answer",
        stem: String(item.stem ?? ""),
        options: Array.isArray(item.options) ? item.options : [],
        answer: String(item.answer ?? ""),
        analysis: String(item.analysis ?? ""),
        confidence,
        pageNumber: primaryRegion.pageNumber,
        bbox: primaryRegion.bbox,
        regions,
        tags: Array.isArray(item.tags) ? [...new Set(item.tags.map(String))].slice(0, 3) : [],
        sourceRunPage: run.pageNumber,
      };
      const previous = candidates.get(number);
      if (!previous || candidate.confidence > previous.confidence) candidates.set(number, candidate);
    }
  }

  const recovered = [...candidates.values()].sort((left, right) => Number(left.number) - Number(right.number));
  if (!apply) {
    console.log(JSON.stringify({ documentId, name: document.name, recoverable: recovered.map(({ number, sourceRunPage, pageNumber, confidence }) => ({ number, sourceRunPage, pageNumber, confidence })) }, null, 2));
  } else {
    const restore = sqlite.transaction(() => {
      const now = new Date().toISOString();
      for (const question of recovered) {
        const questionId = randomUUID();
        sqlite.prepare(
          `INSERT INTO questions
            (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json, status, needs_human_review, confidence, score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_attention', 1, ?, 0, ?, ?)`,
        ).run(questionId, documentId, question.number, question.type, question.stem, JSON.stringify(question.options), question.answer, question.analysis, question.pageNumber, JSON.stringify(question.bbox), question.confidence, now, now);
        for (const [position, region] of question.regions.entries()) {
          sqlite.prepare(
            "INSERT INTO question_regions (id, question_id, page_id, page_number, bbox_json, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(randomUUID(), questionId, pageByNumber.get(region.pageNumber)?.id ?? null, region.pageNumber, JSON.stringify(region.bbox), position, now);
        }
        for (const tagName of question.tags) {
          sqlite.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(randomUUID(), tagName, now);
          sqlite.prepare("INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?").run(questionId, tagName);
        }
      }
      if (recovered.length) sqlite.prepare("UPDATE documents SET status = 'reviewing', error = NULL, updated_at = ? WHERE id = ?").run(now, documentId);
    });
    restore();
    console.log(JSON.stringify({ documentId, name: document.name, recovered: recovered.map((question) => question.number) }, null, 2));
  }
} finally {
  sqlite.close();
}
