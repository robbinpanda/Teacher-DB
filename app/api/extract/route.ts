import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb, getSqlite, sqliteTransaction } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { documents, extractionRuns } from "../../../db/schema";
import {
  normalizeWholeDocumentExtraction,
  parseExtractionJson,
  wholeDocumentSystemPrompt,
} from "../../../lib/document-extraction";
import { activateExtractionRun } from "../../../lib/extraction-run";
import { stageFromGrade } from "../../../lib/education-taxonomy";
import { contentTypeForKey, deleteFile, getFile, putFile } from "../../../lib/file-storage";
import { assertDocumentLease, LostDocumentLeaseError } from "../../../lib/job-lease";
import { resolveModelProfile } from "../../../lib/model-profiles";
import { now, requestOwner } from "../../../lib/server";
import { getTagCatalog } from "../../../lib/tag-catalog";
import { callVisionModel, ModelCallError } from "../../../lib/vision-model";

export const runtime = "nodejs";

const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 120 * 1024 * 1024;
const PIPELINE_VERSION = "whole-document-v1";

type SourcePage = {
  id: string;
  pageNumber: number;
  storageKey: string;
  width: number;
  height: number;
};

async function prepareAssetCrops(input: {
  documentId: string;
  questions: ReturnType<typeof normalizeWholeDocumentExtraction>["questions"];
  sourcePages: SourcePage[];
  pageBytes: Map<number, Buffer>;
  skipQuestionNumbers: Set<string>;
}) {
  const createdKeys: string[] = [];
  for (const question of input.questions) {
    if (input.skipQuestionNumbers.has(question.number)) continue;
    for (const asset of question.assets) {
      const page = input.sourcePages.find((candidate) => candidate.pageNumber === asset.page);
      const bytes = input.pageBytes.get(asset.page);
      if (!page || !bytes) throw new Error(`无法裁剪第 ${question.number} 题第 ${asset.page} 页图片`);
      const image = sharp(bytes, { failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) throw new Error(`无法读取第 ${asset.page} 页图像尺寸`);
      const left = Math.min(metadata.width - 1, Math.max(0, Math.floor(metadata.width * asset.bbox.x / 100)));
      const top = Math.min(metadata.height - 1, Math.max(0, Math.floor(metadata.height * asset.bbox.y / 100)));
      const width = Math.max(1, Math.min(metadata.width - left, Math.round(metadata.width * asset.bbox.width / 100)));
      const height = Math.max(1, Math.min(metadata.height - top, Math.round(metadata.height * asset.bbox.height / 100)));
      const crop = await image.extract({ left, top, width, height }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const cropKey = `documents/${input.documentId}/crops/${question.id}/${asset.id}.jpg`;
      await putFile(cropKey, crop);
      createdKeys.push(cropKey);
      asset.sourceKey = page.storageKey;
      asset.cropKey = cropKey;
    }
  }
  return createdKeys;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

function persistWholeDocumentResult(input: {
  documentId: string;
  workerId?: string;
  parsedContent: unknown;
  normalized: ReturnType<typeof normalizeWholeDocumentExtraction>;
  sourcePages: SourcePage[];
  profile: { id: string; provider: string; model: string };
  finishedAt: string;
}) {
  const { documentId, workerId, parsedContent, normalized, sourcePages, profile, finishedAt } = input;
  sqliteTransaction((transaction) => {
    if (workerId) assertDocumentLease(transaction, documentId, workerId, finishedAt);
    const numbers = normalized.questions.map((question) => question.number);
    transaction.prepare(
      `DELETE FROM questions WHERE document_id = ? AND status <> 'approved'
         AND number NOT IN (${placeholders(numbers.length)})`,
    ).run(documentId, ...numbers);

    for (const question of normalized.questions) {
      const existing = transaction.prepare(
        "SELECT id, status FROM questions WHERE document_id = ? AND number = ? LIMIT 1",
      ).get(documentId, question.number) as { id: string; status: string } | undefined;
      const questionId = existing?.id ?? question.id;
      if (!existing) {
        transaction.prepare(
          `INSERT INTO questions
            (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json,
             status, needs_human_review, confidence, score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(
          questionId, documentId, question.number, question.type, question.stem,
          JSON.stringify(question.options ?? []), question.answer, question.analysis, question.page,
          JSON.stringify(question.bbox), question.status, question.needsHumanReview ? 1 : 0,
          question.confidence, finishedAt, finishedAt,
        );
      } else if (existing.status !== "approved") {
        transaction.prepare(
          `UPDATE questions SET type = ?, stem = ?, options_json = ?, answer = ?, analysis = ?,
             page_number = ?, bbox_json = ?, status = ?, needs_human_review = ?, confidence = ?,
             score = 0, updated_at = ? WHERE id = ?`,
        ).run(
          question.type, question.stem, JSON.stringify(question.options ?? []), question.answer,
          question.analysis, question.page, JSON.stringify(question.bbox), question.status,
          question.needsHumanReview ? 1 : 0, question.confidence, finishedAt, questionId,
        );
      }
      if (existing?.status === "approved") continue;

      // AI 不再写题目范围；question_regions 只保存教师手动框选结果。
      transaction.prepare("DELETE FROM question_regions WHERE question_id = ?").run(questionId);
      transaction.prepare("DELETE FROM question_assets WHERE question_id = ?").run(questionId);
      for (const [position, asset] of question.assets.entries()) {
        const page = sourcePages.find((candidate) => candidate.pageNumber === asset.page);
        transaction.prepare(
          `INSERT INTO question_assets
            (id, question_id, page_id, kind, role, label, source_key, crop_key, bbox_json, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          asset.id, questionId, page?.id ?? null, asset.kind, asset.role, asset.label,
          asset.sourceKey ?? page?.storageKey ?? null, asset.cropKey ?? null,
          JSON.stringify(asset.bbox), position, finishedAt,
        );
      }
      transaction.prepare("DELETE FROM question_tags WHERE question_id = ?").run(questionId);
      for (const name of question.tags) {
        transaction.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)")
          .run(crypto.randomUUID(), name, finishedAt);
        transaction.prepare(
          "INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
        ).run(questionId, name);
      }
    }

    const rawJson = JSON.stringify({
      ...(parsedContent as Record<string, unknown>),
      _pipeline: { version: PIPELINE_VERSION, ...normalized.diagnostics },
    });
    transaction.prepare(
      `UPDATE extraction_runs SET model_profile_id = ?, provider = ?, model = ?, status = 'complete',
         raw_json = ?, error = NULL, error_code = NULL, next_attempt_at = NULL,
         lease_owner = NULL, lease_expires_at = NULL, finished_at = ?
       WHERE document_id = ?`,
    ).run(profile.id, profile.provider, profile.model, rawJson, finishedAt, documentId);
    transaction.prepare(
      "UPDATE documents SET status = 'extracting', error = NULL, updated_at = ? WHERE id = ?",
    ).run(finishedAt, documentId);

    const meta = normalized.documentMeta;
    const inferredYear = Number(meta.year);
    transaction.prepare(
      `UPDATE documents SET
         source_year = CASE WHEN source_year IS NULL AND ? BETWEEN 1900 AND 2200 THEN ? ELSE source_year END,
         source_exam_type = CASE WHEN COALESCE(source_exam_type, '') = '' THEN NULLIF(?, '') ELSE source_exam_type END,
         source_region = CASE WHEN COALESCE(source_region, '') = '' THEN NULLIF(?, '') ELSE source_region END,
         source_school = CASE WHEN COALESCE(source_school, '') = '' THEN NULLIF(?, '') ELSE source_school END
       WHERE id = ?`,
    ).run(
      inferredYear, inferredYear, String(meta.examType ?? "").slice(0, 80),
      String(meta.region ?? "").slice(0, 80), String(meta.school ?? "").slice(0, 120), documentId,
    );
  });
}

export async function POST(request: Request) {
  const payload = await request.json() as {
    documentId?: string;
    fileName?: string;
    profileId?: string;
    workerId?: string;
  };
  if (!payload.documentId) return Response.json({ error: "documentId 为必填项" }, { status: 400 });
  const documentId = payload.documentId;
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const db = getDb();
  const ownedDocument = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)),
  });
  if (!ownedDocument) return Response.json({ error: "文档不存在" }, { status: 404 });
  const sqlite = getSqlite();
  const activeJob = sqlite.prepare("SELECT status FROM document_jobs WHERE document_id = ?")
    .get(documentId) as { status: string } | undefined;
  if (activeJob?.status === "processing" && !payload.workerId) {
    return Response.json({ error: "识别任务正在由队列处理，拒绝无租约的并发写入", code: "worker_required" }, { status: 409 });
  }
  if (payload.workerId) {
    try {
      assertDocumentLease(sqlite, documentId, payload.workerId, now());
    } catch (error) {
      if (error instanceof LostDocumentLeaseError) {
        return Response.json({ error: error.message, code: error.code, retryable: false }, { status: 409 });
      }
      throw error;
    }
  }

  const sourcePages = sqlite.prepare(
    `SELECT id, page_number AS pageNumber, storage_key AS storageKey, width, height
       FROM pages WHERE document_id = ? ORDER BY page_number`,
  ).all(documentId) as SourcePage[];
  if (!sourcePages.length || sourcePages.length !== ownedDocument.pageCount
    || sourcePages.some((page, index) => page.pageNumber !== index + 1)) {
    return Response.json({ error: `原卷页面不完整，当前保存 ${sourcePages.length}/${ownedDocument.pageCount} 页` }, { status: 409 });
  }

  const idempotencyKey = `${documentId}:page:1:extract-v4`;
  const existingRun = await db.query.extractionRuns.findFirst({
    where: and(eq(extractionRuns.idempotencyKey, idempotencyKey), eq(extractionRuns.status, "complete")),
  });
  if (existingRun) {
    return Response.json({
      runId: existingRun.id,
      provider: existingRun.provider,
      model: existingRun.model,
      mode: "whole-document",
      idempotentReplay: true,
    });
  }

  let profile;
  try {
    profile = await resolveModelProfile(ownerId, payload.profileId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型配置不可用" }, { status: 400 });
  }
  const firstPage = sourcePages[0];
  const createdAt = now();
  const activeRun = activateExtractionRun(sqlite, {
    proposedRunId: crypto.randomUUID(),
    documentId,
    pageId: firstPage.id,
    pageNumber: 1,
    profileId: profile.id,
    provider: profile.provider,
    model: profile.model,
    idempotencyKey,
    timestamp: createdAt,
  });

  try {
    const modelImages: Array<{ page: number; dataUrl: string }> = [];
    const pageBytes = new Map<number, Buffer>();
    let totalBytes = 0;
    for (const page of sourcePages) {
      const bytes = await getFile(page.storageKey);
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_PAGE_BYTES) {
        throw new ModelCallError(`第 ${page.pageNumber} 页图像超过 20 MB`, "page_too_large", false, 413);
      }
      if (totalBytes > MAX_DOCUMENT_BYTES) {
        throw new ModelCallError("整份试卷图像总量超过 120 MB，请降低 PDF 清晰度后重新上传", "document_too_large", false, 413);
      }
      pageBytes.set(page.pageNumber, bytes);
      modelImages.push({
        page: page.pageNumber,
        dataUrl: `data:${contentTypeForKey(page.storageKey)};base64,${bytes.toString("base64")}`,
      });
    }
    const tagCatalog = await getTagCatalog(ownerId, ownedDocument.subject || "数学", stageFromGrade(ownedDocument.grade));
    const allowedTags = tagCatalog.map((item) => item.name);
    const result = await callVisionModel({
      ownerId,
      profileId: profile.id,
      purpose: "page_extraction",
      documentId,
      pageCount: sourcePages.length,
      system: `${wholeDocumentSystemPrompt}\n允许标签（只能逐字选择）：${JSON.stringify(allowedTags)}`,
      text: [
        `文件：${payload.fileName ?? ownedDocument.name}。这是同一份试卷完整的 ${sourcePages.length} 页，请在一次响应中返回整卷结构化结果。`,
        `页面尺寸：${sourcePages.map((page) => `第${page.pageNumber}页 ${page.width}×${page.height}`).join("；")}。`,
        "先通读全部页面，关联题目与答案解析，再复核题号从 1 连续到最后一题。不要返回题目整体 regions；只为真正需要保留的题图或答案图返回 assets bbox。",
      ].join(" "),
      images: modelImages,
      jsonMode: true,
    });
    const parsedContent = parseExtractionJson(result.content);
    const normalized = normalizeWholeDocumentExtraction(parsedContent, {
      pageCount: sourcePages.length,
      allowedTags,
    });
    const approvedNumbers = new Set((sqlite.prepare(
      "SELECT number FROM questions WHERE document_id = ? AND status = 'approved'",
    ).all(documentId) as Array<{ number: string }>).map((row) => row.number));
    const createdCropKeys = await prepareAssetCrops({
      documentId,
      questions: normalized.questions,
      sourcePages,
      pageBytes,
      skipQuestionNumbers: approvedNumbers,
    });
    const finishedAt = now();
    try {
      persistWholeDocumentResult({
        documentId,
        workerId: payload.workerId,
        parsedContent,
        normalized,
        sourcePages,
        profile,
        finishedAt,
      });
    } catch (error) {
      await Promise.allSettled(createdCropKeys.map((key) => deleteFile(key)));
      throw error;
    }
    return Response.json({
      runId: activeRun.id,
      provider: profile.provider,
      model: profile.model,
      modelProfileId: profile.id,
      mode: "whole-document",
      idempotentReplay: false,
      pageCount: sourcePages.length,
      questions: normalized.questions,
    });
  } catch (error) {
    if (error instanceof LostDocumentLeaseError) {
      return Response.json({ error: error.message, code: error.code, retryable: false, runId: activeRun.id }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "整卷识别失败";
    const finishedAt = now();
    if (!payload.workerId) {
      sqliteTransaction((transaction) => {
        transaction.prepare(
          "UPDATE extraction_runs SET status = 'failed', error = ?, finished_at = ? WHERE idempotency_key = ?",
        ).run(message.slice(0, 4000), finishedAt, idempotencyKey);
        transaction.prepare("UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
          .run(message.slice(0, 4000), finishedAt, documentId);
      });
    }
    return Response.json({
      error: message,
      runId: activeRun.id,
      code: error instanceof ModelCallError ? error.code : "extraction_error",
      retryable: error instanceof ModelCallError ? error.retryable : true,
      retryAfterMs: error instanceof ModelCallError ? error.retryAfterMs : undefined,
    }, { status: error instanceof ModelCallError && error.status === 413 ? 413 : 502 });
  }
}
