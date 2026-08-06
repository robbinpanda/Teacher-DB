import "server-only";

import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { contentTypeForKey, getFile } from "./file-storage";
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
  documentName: string;
  subject: string | null;
  grade: string | null;
  sourceYear: number | null;
  sourceExamType: string | null;
  sourceRegion: string | null;
  sourceSchool: string | null;
  sourceRemovedAt: string | null;
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
  pageWidth: number | null;
  pageHeight: number | null;
};

type RegionRow = {
  questionId: string;
  page: number;
  bboxJson: string;
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
            p.storage_key AS pageStorageKey, p.width AS pageWidth, p.height AS pageHeight
       FROM question_assets a
       LEFT JOIN pages p ON p.id = a.page_id
      WHERE a.question_id IN (${placeholders(ids.length)})
      ORDER BY a.created_at, a.id`,
  ).all(...ids) as AssetRow[];
  const regions = sqlite.prepare(
    `SELECT question_id AS questionId, page_number AS page, bbox_json AS bboxJson
       FROM question_regions
      WHERE question_id IN (${placeholders(ids.length)})
      ORDER BY position, page_number`,
  ).all(...ids) as RegionRow[];
  const tagRows = sqlite.prepare(
    `SELECT qt.question_id AS questionId, t.name
       FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
      WHERE qt.question_id IN (${placeholders(ids.length)})
      ORDER BY t.name`,
  ).all(...ids) as Array<{ questionId: string; name: string }>;

  return rows.map((row) => {
    const questionAssets: QuestionAsset[] = assets.filter((asset) => asset.questionId === row.id).map((asset) => {
      const bbox = parseJson<BoundingBox>(asset.bboxJson, { x: 0, y: 0, width: 10, height: 10 });
      return {
        id: asset.id,
        kind: (["figure", "table", "graph"].includes(asset.kind) ? asset.kind : "figure") as QuestionAsset["kind"],
        page: asset.pageNumber ?? row.pageNumber,
        bbox,
        label: asset.label,
        sourceKey: asset.sourceKey ?? asset.pageStorageKey,
        cropKey: asset.cropKey,
        url: fileUrl(asset.cropKey),
        width: asset.pageWidth ? Math.max(1, Math.round(asset.pageWidth * bbox.width / 100)) : undefined,
        height: asset.pageHeight ? Math.max(1, Math.round(asset.pageHeight * bbox.height / 100)) : undefined,
      };
    });
    const questionRegions = regions.filter((region) => region.questionId === row.id).map((region) => ({
      page: region.page,
      bbox: parseJson<BoundingBox>(region.bboxJson, { x: 0, y: 0, width: 10, height: 10 }),
    }));
    const legacyBox = parseJson<BoundingBox>(row.bboxJson, { x: 0, y: 0, width: 10, height: 10 });
    return {
      id: row.id,
      number: row.number,
      type: (["single", "multiple", "fill", "answer"].includes(row.type) ? row.type : "answer") as QuestionType,
      stem: row.stem,
      options: parseJson<Question["options"]>(row.optionsJson, []),
      answer: row.answer,
      analysis: row.analysis,
      page: row.pageNumber,
      bbox: legacyBox,
      regions: questionRegions.length ? questionRegions : [{ page: row.pageNumber, bbox: legacyBox }],
      assets: questionAssets,
      tags: tagRows.filter((tag) => tag.questionId === row.id).map((tag) => tag.name),
      confidence: row.confidence,
      status: (["pending", "approved", "needs_attention"].includes(row.status) ? row.status : "pending") as Question["status"],
      source: {
        documentId: row.documentId,
        documentName: row.documentName,
        subject: row.subject ?? "未设置学科",
        grade: row.grade ?? "未设置年级",
        year: row.sourceYear,
        examType: row.sourceExamType,
        region: row.sourceRegion,
        school: row.sourceSchool,
        sourceRemoved: Boolean(row.sourceRemovedAt),
      },
    };
  });
}

const questionSelect = `
  SELECT q.id, q.document_id AS documentId, q.number, q.type, q.stem,
         q.options_json AS optionsJson, q.answer, q.analysis, q.page_number AS pageNumber,
         q.bbox_json AS bboxJson, q.status, q.confidence,
         d.name AS documentName, d.subject, d.grade, d.source_year AS sourceYear,
         d.source_exam_type AS sourceExamType, d.source_region AS sourceRegion,
         d.source_school AS sourceSchool, d.source_removed_at AS sourceRemovedAt
    FROM questions q JOIN documents d ON d.id = q.document_id`;

export async function getReviewData(documentId: string, ownerId: string) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const documentRow = sqlite.prepare(
    `SELECT d.id, d.name, d.subject, d.grade, d.source_year AS year,
            d.source_exam_type AS examType, d.source_region AS region, d.source_school AS school,
            d.status, d.error, d.page_count AS pageCount,
            j.status AS jobStatus, j.next_attempt_at AS nextAttemptAt,
            COUNT(q.id) AS questionCount,
            COALESCE(SUM(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount
       FROM documents d LEFT JOIN questions q ON q.document_id = d.id
       LEFT JOIN document_jobs j ON j.document_id = d.id
      WHERE d.id = ? AND d.owner_id = ? AND d.source_removed_at IS NULL GROUP BY d.id`,
  ).get(documentId, ownerId) as (Omit<ReviewDocument, "subject" | "grade"> & { subject: string | null; grade: string | null }) | undefined;
  if (!documentRow) return null;
  const pages = sqlite.prepare(
    `SELECT p.id, p.page_number AS pageNumber, p.storage_key AS storageKey, p.width, p.height,
            COALESCE(r.status, 'queued') AS extractionStatus, COALESCE(r.attempt, 0) AS extractionAttempt,
            r.error AS extractionError, r.next_attempt_at AS nextAttemptAt
       FROM pages p LEFT JOIN extraction_runs r
         ON r.idempotency_key = p.document_id || ':page:' || p.page_number || ':extract-v3'
      WHERE p.document_id = ? ORDER BY p.page_number`,
  ).all(documentId) as Array<{
    id: string; pageNumber: number; storageKey: string; width: number; height: number;
    extractionStatus: ReviewPage["extractionStatus"]; extractionAttempt: number; extractionError: string | null; nextAttemptAt: string | null;
  }>;
  const questionRows = sqlite.prepare(
    `${questionSelect} WHERE d.id = ? AND d.owner_id = ?
      ORDER BY q.page_number, CAST(q.number AS INTEGER), q.number, q.created_at`,
  ).all(documentId, ownerId) as QuestionRow[];
  const reviewPages = pages.map((page): ReviewPage => ({
      id: page.id,
      pageNumber: page.pageNumber,
      imageUrl: fileUrl(page.storageKey)!,
      width: page.width,
      height: page.height,
      extractionStatus: page.extractionStatus,
      extractionAttempt: page.extractionAttempt,
      extractionError: page.extractionError,
      nextAttemptAt: page.nextAttemptAt,
    }));
  return {
    document: {
      ...documentRow,
      subject: documentRow.subject ?? "未设置学科",
      grade: documentRow.grade ?? "未设置年级",
      completedPageCount: reviewPages.filter((page) => page.extractionStatus === "complete").length,
      failedPageCount: reviewPages.filter((page) => page.extractionStatus === "failed").length,
    } satisfies ReviewDocument,
    pages: reviewPages,
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

export type QuestionSearchOptions = {
  query?: string;
  type?: string;
  tag?: string;
  documentId?: string;
  subject?: string;
  grade?: string;
  stage?: string;
  year?: number;
  examType?: string;
  region?: string;
  school?: string;
  page?: number;
  pageSize?: number;
};

function likePattern(value: string) {
  return `%${value.replace(/([%_\\])/g, "\\$1")}%`;
}

export async function searchApprovedQuestions(ownerId: string, options: QuestionSearchOptions = {}) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const clauses = ["d.owner_id = ?", "q.status = 'approved'"];
  const params: Array<string | number> = [ownerId];
  if (options.type && ["single", "multiple", "fill", "answer"].includes(options.type)) {
    clauses.push("q.type = ?"); params.push(options.type);
  }
  if (options.documentId) { clauses.push("d.id = ?"); params.push(options.documentId); }
  if (options.subject) { clauses.push("d.subject = ?"); params.push(options.subject); }
  if (options.grade) { clauses.push("d.grade = ?"); params.push(options.grade); }
  if (options.stage === "primary") clauses.push("d.grade NOT LIKE '%初%' AND d.grade NOT LIKE '%高%' AND d.grade NOT LIKE '%七%' AND d.grade NOT LIKE '%八%' AND d.grade NOT LIKE '%九%'");
  if (options.stage === "middle") clauses.push("(d.grade LIKE '%初%' OR d.grade LIKE '%七%' OR d.grade LIKE '%八%' OR d.grade LIKE '%九%')");
  if (options.stage === "high") clauses.push("(d.grade LIKE '%高一%' OR d.grade LIKE '%高二%' OR d.grade LIKE '%高三%' OR d.grade LIKE '%高中%')");
  if (options.year) { clauses.push("d.source_year = ?"); params.push(options.year); }
  if (options.examType) { clauses.push("d.source_exam_type = ?"); params.push(options.examType); }
  if (options.region) { clauses.push("d.source_region = ?"); params.push(options.region); }
  if (options.school) { clauses.push("d.source_school = ?"); params.push(options.school); }
  if (options.tag) {
    clauses.push("EXISTS (SELECT 1 FROM question_tags sqt JOIN tags st ON st.id = sqt.tag_id WHERE sqt.question_id = q.id AND st.name = ?)");
    params.push(options.tag);
  }
  const query = options.query?.trim();
  if (query) {
    const pattern = likePattern(query);
    clauses.push(`(
      q.stem LIKE ? ESCAPE '\\' OR q.answer LIKE ? ESCAPE '\\' OR q.analysis LIKE ? ESCAPE '\\'
      OR d.name LIKE ? ESCAPE '\\' OR COALESCE(d.subject, '') LIKE ? ESCAPE '\\'
      OR COALESCE(d.grade, '') LIKE ? ESCAPE '\\' OR COALESCE(d.source_exam_type, '') LIKE ? ESCAPE '\\'
      OR COALESCE(d.source_region, '') LIKE ? ESCAPE '\\' OR COALESCE(d.source_school, '') LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM question_tags qqt JOIN tags tt ON tt.id = qqt.tag_id WHERE qqt.question_id = q.id AND tt.name LIKE ? ESCAPE '\\')
    )`);
    params.push(...Array.from({ length: 10 }, () => pattern));
  }
  const where = clauses.join(" AND ");
  const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize ?? 30)));
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const total = (sqlite.prepare(
    `SELECT COUNT(*) AS total FROM questions q JOIN documents d ON d.id = q.document_id WHERE ${where}`,
  ).get(...params) as { total: number }).total;
  const rows = sqlite.prepare(
    `${questionSelect} WHERE ${where}
      ORDER BY d.created_at DESC, q.page_number, CAST(q.number AS INTEGER), q.number
      LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, (page - 1) * pageSize) as QuestionRow[];
  return {
    questions: await hydrateQuestions(rows),
    pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getBankData(ownerId: string) {
  const result = await searchApprovedQuestions(ownerId, { pageSize: 30 });
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
  const sources = sqlite.prepare(
    `SELECT DISTINCT d.id, d.name, d.source_year AS year, d.source_exam_type AS examType,
            d.source_region AS region, d.source_school AS school
       FROM documents d JOIN questions q ON q.document_id = d.id
      WHERE d.owner_id = ? AND q.status = 'approved' ORDER BY d.created_at DESC`,
  ).all(ownerId) as Array<{ id: string; name: string; year: number | null; examType: string | null; region: string | null; school: string | null }>;
  return { ...result, stats, tags: tags.map((tag) => tag.name), sources };
}

export async function getDocuments(ownerId: string): Promise<SourceDocument[]> {
  await ensureDatabase();
  const rows = getSqlite().prepare(
    `SELECT d.id, d.name, COALESCE(d.subject, '未设置学科') AS subject,
            COALESCE(d.grade, '未设置年级') AS grade, d.page_count AS pageCount,
            d.status, d.created_at AS createdAt, COUNT(q.id) AS questionCount,
            COALESCE(SUM(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount,
            (SELECT COUNT(*) FROM extraction_runs r WHERE r.document_id = d.id AND r.status = 'complete') AS completedPageCount,
            (SELECT COUNT(*) FROM extraction_runs r WHERE r.document_id = d.id AND r.status = 'failed') AS failedPageCount,
            (SELECT COUNT(*) FROM extraction_runs r WHERE r.document_id = d.id AND r.status = 'retry_wait') AS retryWaitPageCount,
            j.status AS jobStatus, j.next_attempt_at AS nextAttemptAt, j.last_error AS lastError
       FROM documents d LEFT JOIN questions q ON q.document_id = d.id
       LEFT JOIN document_jobs j ON j.document_id = d.id
      WHERE d.owner_id = ? AND d.source_removed_at IS NULL GROUP BY d.id ORDER BY d.created_at DESC LIMIT 100`,
  ).all(ownerId) as SourceDocument[];
  return rows;
}

export type SavedPaper = {
  id: string;
  title: string;
  subtitle: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  questions: QuestionWithSource[];
};

export async function getPaperData(paperId: string, ownerId: string): Promise<SavedPaper | null> {
  await ensureDatabase();
  const sqlite = getSqlite();
  const paper = sqlite.prepare(
    `SELECT id, title, COALESCE(subtitle, '') AS subtitle, settings_json AS settingsJson,
            created_at AS createdAt, updated_at AS updatedAt
       FROM papers WHERE id = ? AND owner_id = ?`,
  ).get(paperId, ownerId) as { id: string; title: string; subtitle: string; settingsJson: string; createdAt: string; updatedAt: string } | undefined;
  if (!paper) return null;
  const items = sqlite.prepare(
    "SELECT question_id AS questionId FROM paper_items WHERE paper_id = ? ORDER BY position",
  ).all(paperId) as Array<{ questionId: string }>;
  const questions = await getApprovedQuestions(ownerId, items.map((item) => item.questionId));
  return {
    id: paper.id,
    title: paper.title,
    subtitle: paper.subtitle,
    settings: parseJson<Record<string, unknown>>(paper.settingsJson, {}),
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
    questions,
  };
}

export async function getPaperPrintData(paperId: string, ownerId: string) {
  const paper = await getPaperData(paperId, ownerId);
  if (!paper) return null;
  const questions = await Promise.all(paper.questions.map(async (question) => ({
    ...question,
    assets: await Promise.all(question.assets.map(async (asset) => {
      if (!asset.cropKey) return asset;
      try {
        const bytes = await getFile(asset.cropKey);
        return { ...asset, url: `data:${contentTypeForKey(asset.cropKey)};base64,${bytes.toString("base64")}` };
      } catch {
        return { ...asset, url: null };
      }
    })),
  })));
  return { ...paper, questions };
}
