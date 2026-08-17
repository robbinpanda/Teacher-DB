import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb, getSqlite, sqliteTransaction } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { documents, extractionRuns } from "../../../db/schema";
import {
  normalizeStreamedQuestion,
  wholeDocumentSystemPrompt,
  type WholeDocumentExtraction,
} from "../../../lib/document-extraction";
import { activateExtractionRun } from "../../../lib/extraction-run";
import { stageFromGrade } from "../../../lib/education-taxonomy";
import { contentTypeForKey, deleteFile, getFile, putFile } from "../../../lib/file-storage";
import { assertDocumentLease, LostDocumentLeaseError } from "../../../lib/job-lease";
import { resolveModelProfile } from "../../../lib/model-profiles";
import { now, requestOwner } from "../../../lib/server";
import { getTagCatalog } from "../../../lib/tag-catalog";
import { callVisionModelStream, ModelCallError } from "../../../lib/vision-model";
import { ExtractionStreamParser, type ExtractionStreamRecord } from "../../../lib/streaming-extraction";
import type { Question } from "../../../lib/types";

export const runtime = "nodejs";

const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 120 * 1024 * 1024;
const PIPELINE_VERSION = "whole-document-stream-v2";

type SourcePage = {
  id: string;
  pageNumber: number;
  storageKey: string;
  width: number;
  height: number;
};

async function prepareAssetCrops(input: {
  documentId: string;
  questions: Question[];
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

function persistStreamedQuestion(input: {
  documentId: string;
  workerId?: string;
  question: Question;
  sourcePages: SourcePage[];
  completedNumbers: string[];
  timestamp: string;
}) {
  const { documentId, workerId, question, sourcePages, completedNumbers, timestamp } = input;
  sqliteTransaction((transaction) => {
    if (workerId) assertDocumentLease(transaction, documentId, workerId, timestamp);
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
        question.confidence, timestamp, timestamp,
      );
    } else if (existing.status !== "approved") {
      transaction.prepare(
        `UPDATE questions SET type = ?, stem = ?, options_json = ?, answer = ?, analysis = ?,
           page_number = ?, bbox_json = ?, status = ?, needs_human_review = ?, confidence = ?,
           score = 0, updated_at = ? WHERE id = ?`,
      ).run(
        question.type, question.stem, JSON.stringify(question.options ?? []), question.answer,
        question.analysis, question.page, JSON.stringify(question.bbox), question.status,
        question.needsHumanReview ? 1 : 0, question.confidence, timestamp, questionId,
      );
    }
    if (existing?.status !== "approved") {
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
          JSON.stringify(asset.bbox), position, timestamp,
        );
      }
      transaction.prepare("DELETE FROM question_tags WHERE question_id = ?").run(questionId);
      for (const name of question.tags) {
        transaction.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)")
          .run(crypto.randomUUID(), name, timestamp);
        transaction.prepare(
          "INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
        ).run(questionId, name);
      }
    }
    transaction.prepare(
      `UPDATE document_jobs SET completed_question_numbers_json = ?, stream_phase = 'receiving',
         stream_message = ?, last_stream_event_at = ?, updated_at = ? WHERE document_id = ?`,
    ).run(
      JSON.stringify(completedNumbers), `已完成第 ${question.number} 题`, timestamp, timestamp, documentId,
    );
  });
}

function updateStreamMeta(input: {
  documentId: string;
  workerId?: string;
  questionTotal: number;
  documentMeta: Record<string, unknown>;
  timestamp: string;
}) {
  sqliteTransaction((transaction) => {
    if (input.workerId) assertDocumentLease(transaction, input.documentId, input.workerId, input.timestamp);
    const inferredYear = Number(input.documentMeta.year);
    transaction.prepare(
      `UPDATE documents SET
         source_year = CASE WHEN source_year IS NULL AND ? BETWEEN 1900 AND 2200 THEN ? ELSE source_year END,
         source_exam_type = CASE WHEN COALESCE(source_exam_type, '') = '' THEN NULLIF(?, '') ELSE source_exam_type END,
         source_region = CASE WHEN COALESCE(source_region, '') = '' THEN NULLIF(?, '') ELSE source_region END,
         source_school = CASE WHEN COALESCE(source_school, '') = '' THEN NULLIF(?, '') ELSE source_school END,
         updated_at = ? WHERE id = ?`,
    ).run(
      inferredYear, inferredYear, String(input.documentMeta.examType ?? "").slice(0, 80),
      String(input.documentMeta.region ?? "").slice(0, 80), String(input.documentMeta.school ?? "").slice(0, 120),
      input.timestamp, input.documentId,
    );
    transaction.prepare(
      `UPDATE document_jobs SET question_total = ?, stream_phase = 'receiving',
         stream_message = ?, last_stream_event_at = ?, updated_at = ? WHERE document_id = ?`,
    ).run(
      input.questionTotal, `已确认共 ${input.questionTotal} 题，正在逐题处理`,
      input.timestamp, input.timestamp, input.documentId,
    );
  });
}

function persistWholeDocumentResult(input: {
  documentId: string;
  workerId?: string;
  parsedContent: unknown;
  normalized: WholeDocumentExtraction;
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
    const approvedNumbers = new Set((sqlite.prepare(
      "SELECT number FROM questions WHERE document_id = ? AND status = 'approved'",
    ).all(documentId) as Array<{ number: string }>).map((row) => row.number));
    const parser = new ExtractionStreamParser();
    const completedNumbers = new Set<string>();
    const rawQuestions = new Map<string, Record<string, unknown>>();
    const streamedQuestions = new Map<string, Question>();
    let questionTotal: number | null = null;
    let documentMeta: Record<string, unknown> = {};
    let receivedDone = false;
    let lastActivityWrite = 0;

    const handleRecord = async (record: ExtractionStreamRecord) => {
      if (record.event === "meta") {
        if (questionTotal !== null) throw new Error("模型重复输出 meta 事件");
        questionTotal = record.questionCount;
        documentMeta = record.documentMeta ?? {};
        updateStreamMeta({ documentId, workerId: payload.workerId, questionTotal, documentMeta, timestamp: now() });
        return;
      }
      if (record.event === "done") {
        if (receivedDone) throw new Error("模型重复输出 done 事件");
        receivedDone = true;
        return;
      }
      if (receivedDone) throw new Error("模型在 done 事件后仍输出题目");
      if (questionTotal === null) throw new Error("模型必须先输出题目总数，再输出各题");
      const question = normalizeStreamedQuestion(record.question, {
        pageCount: sourcePages.length,
        allowedTags,
      });
      if (Number(question.number) > questionTotal) {
        throw new Error(`模型输出第 ${question.number} 题，超过已声明的 ${questionTotal} 题`);
      }
      if (completedNumbers.has(question.number)) throw new Error(`模型重复输出第 ${question.number} 题`);
      const createdCropKeys = await prepareAssetCrops({
        documentId,
        questions: [question],
        sourcePages,
        pageBytes,
        skipQuestionNumbers: approvedNumbers,
      });
      completedNumbers.add(question.number);
      const orderedCompleted = Array.from(completedNumbers).sort((left, right) => Number(left) - Number(right));
      try {
        persistStreamedQuestion({
          documentId,
          workerId: payload.workerId,
          question,
          sourcePages,
          completedNumbers: orderedCompleted,
          timestamp: now(),
        });
      } catch (error) {
        completedNumbers.delete(question.number);
        await Promise.allSettled(createdCropKeys.map((key) => deleteFile(key)));
        throw error;
      }
      rawQuestions.set(question.number, record.question);
      streamedQuestions.set(question.number, question);
    };

    await callVisionModelStream({
      ownerId,
      profileId: profile.id,
      purpose: "page_extraction",
      documentId,
      pageCount: sourcePages.length,
      system: `${wholeDocumentSystemPrompt}\n允许标签（只能逐字选择）：${JSON.stringify(allowedTags)}`,
      text: [
        `文件：${payload.fileName ?? ownedDocument.name}。这是同一份试卷完整的 ${sourcePages.length} 页。只调用一次模型，但必须按 meta、逐题 question、done 的事件顺序流式返回。`,
        `页面尺寸：${sourcePages.map((page) => `第${page.pageNumber}页 ${page.width}×${page.height}`).join("；")}。`,
        "先通读全部页面，关联题目与答案解析，再复核题号从 1 连续到最后一题。不要返回题目整体 regions。所有表格和茎叶图一律作为 kind=table 的 assets 截图保存，禁止在 stem、options、answer、analysis 中用 LaTeX、Markdown 或纯文字重复转写表格；图标数据、坐标图等视觉布局也必须作为 assets 保存。再次强调：每个 asset 必须包含整数 page，bbox 必须是含 x、y、width、height 的 JSON 对象，绝不能输出数组 bbox。",
      ].join(" "),
      images: modelImages,
    }, {
      onTextDelta: async (delta) => {
        for (const record of parser.push(delta)) await handleRecord(record);
      },
      onActivity: ({ kind }) => {
        const timestampMs = Date.now();
        if (timestampMs - lastActivityWrite < 1000) return;
        lastActivityWrite = timestampMs;
        const timestamp = new Date(timestampMs).toISOString();
        sqliteTransaction((transaction) => {
          if (payload.workerId) assertDocumentLease(transaction, documentId, payload.workerId, timestamp);
          transaction.prepare(
            `UPDATE document_jobs SET stream_phase = ?, stream_message = ?,
               last_stream_event_at = ?, updated_at = ? WHERE document_id = ?`,
          ).run(
            kind === "thinking" ? "thinking" : "receiving",
            kind === "thinking" ? "模型正在通读和思考整卷" : "正在接收模型流式结果",
            timestamp, timestamp, documentId,
          );
        });
      },
    });
    for (const record of parser.finish()) await handleRecord(record);
    if (questionTotal === null) throw new Error("模型流结束时仍未输出题目总数");
    if (!receivedDone) throw new Error("模型流未输出 done 事件");
    const orderedNumbers = Array.from(completedNumbers).sort((left, right) => Number(left) - Number(right));
    const expectedNumbers = Array.from({ length: questionTotal }, (_, index) => String(index + 1));
    const missingNumbers = expectedNumbers.filter((number) => !completedNumbers.has(number));
    if (missingNumbers.length || orderedNumbers.length !== questionTotal) {
      throw new Error(`模型流题目不完整，缺少第 ${missingNumbers.join("、") || "未知"} 题`);
    }
    const normalized: WholeDocumentExtraction = {
      questions: orderedNumbers.map((number) => streamedQuestions.get(number)!),
      documentMeta,
      diagnostics: {
        acceptedQuestionNumbers: orderedNumbers,
        discardedQuestionNumbers: [],
        missingQuestionNumbers: [],
      },
    };
    const parsedContent = {
      documentMeta,
      questions: orderedNumbers.map((number) => rawQuestions.get(number)),
    };
    const finishedAt = now();
    sqliteTransaction((transaction) => {
      if (payload.workerId) assertDocumentLease(transaction, documentId, payload.workerId, finishedAt);
      transaction.prepare(
        `UPDATE document_jobs SET stream_phase = 'finalizing', stream_message = '全部题目已接收，正在校验并生成审核数据',
           last_stream_event_at = ?, updated_at = ? WHERE document_id = ?`,
      ).run(finishedAt, finishedAt, documentId);
    });
    persistWholeDocumentResult({
      documentId,
      workerId: payload.workerId,
      parsedContent,
      normalized,
      sourcePages,
      profile,
      finishedAt,
    });
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
