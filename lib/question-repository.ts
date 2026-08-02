import "server-only";

import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import type {
  BoundingBox,
  Question,
  QuestionAsset,
  QuestionType,
  QuestionWithSource,
  ReviewDocument,
  ReviewPage,
  SourceDocument,
} from "./types";

type QuestionRow = {
  id: string;
  documentId: string;
  number: string;
  type: string;
  stem: string;
  optionsJson: string | null;
  answer: string;
  analysis: string;
  pageNumber: number;
  bboxJson: string;
  status: string;
  confidence: number;
  score: number;
  documentName: string;
  subject: string | null;
  grade: string | null;
  sourceYear: number | null;
  sourceExamType: string | null;
  sourceRegion: string | null;
  sourceSchool: string | null;
};

type AssetRow = {
  id: string;
  questionId: string;
  kind: string;
  label: string;
  sourceKey: string | null;
  cropKey: string | null;
  bboxJson: string;
  pageNumber: number | null;
  pageStorageKey: string | null;
};

function fileUrl(key: string | null | undefined) {
  if (!key) return null;
  return "/api/files/" + key.split("/").map(encodeURIComponent).join("/");
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

async function hydrateQuestions(rows: QuestionRow[]): Promise<QuestionWithSource[]> {
  if (!rows.length) return [];
  const sqlite = getSqlite();
  const ids = rows.map((row) => row.id);
  const assets = sqlite.prepare(
    `SELECT a.id, a.question_id AS questionId, a.kind, a.label, a.source_key AS sourceKey,
            a.crop_key AS cropKey, a.bbox_json AS bboxJson, p.page_number AS pageNumber,
            p.storage_key AS pageStorageKey
       FROM question_assets a
       LEFT JOIN pages p ON p.id = a.page_id
      WHERE a.question_id IN (${placeholders(ids.length)})
      ORDER BY a.created_at, a.id`,
  ).all(...ids) as AssetRow[];
  const tagRows = sqlite.prepare(
    `SELECT qt.question_id AS questionId, t.name
       FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
      WHERE qt.question_id IN (${placeholders(ids.length)})
      ORDER BY t.name`,
  ).all(...ids) as Array<{ questionId: string; name: string }>;

  return rows.map((row) => {
    const questionAssets: QuestionAsset[] = assets.filter((asset) => asset.questionId === row.id).map((asset) => ({
      id: asset.id,
      kind: (["figure", "table", "graph"].includes(asset.kind) ? asset.kind : "figure") as QuestionAsset["kind"],
      page: asset.pageNumber ?? row.pageNumber,
      bbox: parseJson<BoundingBox>(asset.bboxJson, { x: 0, y: 0, width: 10, height: 10 }),
      label: asset.label,
      sourceKey: asset.sourceKey ?? asset.pageStorageKey,
      cropKey: asset.cropKey,
      url: fileUrl(asset.cropKey),
    }));
    return {
      id: row.id,
      number: row.number,
      type: (["single", "multiple", "fill", "answer"].includes(row.type) ? row.type : "answer") as QuestionType,
      stem: row.stem,
      options: parseJson<Question["options"]>(row.optionsJson, []),
      answer: row.answer,
      analysis: row.analysis,
      page: row.pageNumber,
      bbox: parseJson<BoundingBox>(row.bboxJson, { x: 0, y: 0, width: 10, height: 10 }),
      assets: questionAssets,
      tags: tagRows.filter((tag) => tag.questionId === row.id).map((tag) => tag.name),
      confidence: row.confidence,
      status: (["pending", "approved", "needs_attention"].includes(row.status) ? row.status : "pending") as Question["status"],
      score: row.score,
      source: {
        documentId: row.documentId,
        documentName: row.documentName,
        subject: row.subject ?? "未设置学科",
        grade: row.grade ?? "未设置年级",
        year: row.sourceYear,
        examType: row.sourceExamType,
        region: row.sourceRegion,
        school: row.sourceSchool,
      },
    };
  });
}

const questionSelect = `
  SELECT q.id, q.document_id AS documentId, q.number, q.type, q.stem,
         q.options_json AS optionsJson, q.answer, q.analysis, q.page_number AS pageNumber,
         q.bbox_json AS bboxJson, q.status, q.confidence, q.score,
         d.name AS documentName, d.subject, d.grade, d.source_year AS sourceYear,
         d.source_exam_type AS sourceExamType, d.source_region AS sourceRegion,
         d.source_school AS sourceSchool
    FROM questions q JOIN documents d ON d.id = q.document_id`;

export async function getReviewData(documentId: string, ownerId: string) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const documentRow = sqlite.prepare(
    `SELECT d.id, d.name, d.subject, d.grade, d.source_year AS year,
            d.source_exam_type AS examType, d.source_region AS region, d.source_school AS school,
            d.status, d.page_count AS pageCount,
            COUNT(q.id) AS questionCount,
            COALESCE(SUM(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount
       FROM documents d LEFT JOIN questions q ON q.document_id = d.id
      WHERE d.id = ? AND d.owner_id = ? GROUP BY d.id`,
  ).get(documentId, ownerId) as (Omit<ReviewDocument, "subject" | "grade"> & { subject: string | null; grade: string | null }) | undefined;
  if (!documentRow) return null;
  const pages = sqlite.prepare(
    `SELECT id, page_number AS pageNumber, storage_key AS storageKey, width, height
       FROM pages WHERE document_id = ? ORDER BY page_number`,
  ).all(documentId) as Array<{ id: string; pageNumber: number; storageKey: string; width: number; height: number }>;
  const questionRows = sqlite.prepare(
    `${questionSelect} WHERE d.id = ? AND d.owner_id = ?
      ORDER BY q.page_number, CAST(q.number AS INTEGER), q.number, q.created_at`,
  ).all(documentId, ownerId) as QuestionRow[];
  return {
    document: { ...documentRow, subject: documentRow.subject ?? "未设置学科", grade: documentRow.grade ?? "未设置年级" } satisfies ReviewDocument,
    pages: pages.map((page): ReviewPage => ({
      id: page.id,
      pageNumber: page.pageNumber,
      imageUrl: fileUrl(page.storageKey)!,
      width: page.width,
      height: page.height,
    })),
    questions: await hydrateQuestions(questionRows),
  };
}

export async function getApprovedQuestions(ownerId: string, ids?: string[]) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const idClause = ids?.length ? ` AND q.id IN (${placeholders(ids.length)})` : "";
  const params = ids?.length ? [ownerId, ...ids] : [ownerId];
  const rows = sqlite.prepare(
    `${questionSelect} WHERE d.owner_id = ? AND q.status = 'approved'${idClause}
      ORDER BY d.created_at DESC, q.page_number, CAST(q.number AS INTEGER), q.number LIMIT 2000`,
  ).all(...params) as QuestionRow[];
  const hydrated = await hydrateQuestions(rows);
  if (!ids?.length) return hydrated;
  const order = new Map(ids.map((id, index) => [id, index]));
  return hydrated.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function getBankData(ownerId: string) {
  const questions = await getApprovedQuestions(ownerId);
  const sqlite = getSqlite();
  const stats = sqlite.prepare(
    `SELECT COUNT(q.id) AS total,
            COALESCE(SUM(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
            COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM question_assets a WHERE a.question_id = q.id) THEN 1 ELSE 0 END), 0) AS withAssets,
            (SELECT COUNT(*) FROM papers p WHERE p.owner_id = ?) AS papers
       FROM questions q JOIN documents d ON d.id = q.document_id WHERE d.owner_id = ?`,
  ).get(ownerId, ownerId) as { total: number; approved: number; withAssets: number; papers: number };
  const tags = sqlite.prepare(
    `SELECT DISTINCT t.name FROM tags t JOIN question_tags qt ON qt.tag_id = t.id
      JOIN questions q ON q.id = qt.question_id JOIN documents d ON d.id = q.document_id
      WHERE d.owner_id = ? AND q.status = 'approved' ORDER BY t.name`,
  ).all(ownerId) as Array<{ name: string }>;
  return { questions, stats, tags: tags.map((tag) => tag.name) };
}

export async function getDocuments(ownerId: string): Promise<SourceDocument[]> {
  await ensureDatabase();
  const rows = getSqlite().prepare(
    `SELECT d.id, d.name, COALESCE(d.subject, '未设置学科') AS subject,
            COALESCE(d.grade, '未设置年级') AS grade, d.page_count AS pageCount,
            d.status, d.created_at AS createdAt, COUNT(q.id) AS questionCount,
            COALESCE(SUM(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount
       FROM documents d LEFT JOIN questions q ON q.document_id = d.id
      WHERE d.owner_id = ? GROUP BY d.id ORDER BY d.created_at DESC LIMIT 30`,
  ).all(ownerId) as SourceDocument[];
  return rows;
}
