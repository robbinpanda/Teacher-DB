import { and, eq, inArray } from "drizzle-orm";
import { getDb, getSqlite, sqliteTransaction } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { assets, documents, extractionRuns, pages, questions } from "../../../db/schema";
import { resolveModelProfile } from "../../../lib/model-profiles";
import { now, requestOwner } from "../../../lib/server";
import type { BoundingBox, Question, QuestionType } from "../../../lib/types";
import { callVisionModel } from "../../../lib/vision-model";

export const runtime = "nodejs";

const systemPrompt = [
  "你是中文中学试卷结构化专家。请只根据给出的页面图像识别题目，不补写看不清的内容。",
  "1. 将每道题题干、选项、答案、解析分开；页面没有答案或解析时填空字符串。",
  "2. 所有数学表达式改写为 LaTeX，并用单个 $ 包裹；普通中文保留原文。",
  "3. bbox 坐标使用页面宽高百分比，范围 0-100，分别为 x,y,width,height。",
  "4. question bbox 覆盖完整题目。assets 只框真正需要随题保存的图、表、函数图象，不要把题干文字放进题图。",
  "5. type 只能是 single、multiple、fill、answer。",
  "6. 如果本页是答案页或解析页，不要把答案条目伪造成新题；放进 answerUpdates，并按题号关联前文题目。",
  "7. 不要输出 Markdown，只输出严格 JSON。",
  "JSON 格式：",
  "{\"questions\":[{\"number\":\"1\",\"type\":\"single\",\"stem\":\"题干，公式如 $x^2$\",\"options\":[{\"key\":\"A\",\"content\":\"选项\"}],\"answer\":\"\",\"analysis\":\"\",\"page\":1,\"bbox\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0},\"assets\":[{\"kind\":\"figure\",\"label\":\"图的说明\",\"page\":1,\"bbox\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0}}],\"tags\":[\"建议知识点\"],\"confidence\":0.95,\"score\":3}],\"answerUpdates\":[{\"number\":\"1\",\"answer\":\"答案 LaTeX\",\"analysis\":\"解析\",\"confidence\":0.95}]}",
].join("\n");

function safeBox(value: unknown): BoundingBox {
  const box = value as Partial<BoundingBox> | null;
  return {
    x: Math.max(0, Math.min(100, Number(box?.x ?? 0))),
    y: Math.max(0, Math.min(100, Number(box?.y ?? 0))),
    width: Math.max(1, Math.min(100, Number(box?.width ?? 10))),
    height: Math.max(1, Math.min(100, Number(box?.height ?? 10))),
  };
}

type AnswerUpdate = { number: string; answer: string; analysis: string; confidence: number };

function normalize(raw: unknown, pageNumber: number): { questions: Question[]; answerUpdates: AnswerUpdate[] } {
  const result = raw as { questions?: unknown[]; answerUpdates?: unknown[] };
  const items = Array.isArray(result?.questions) ? result.questions : [];
  const rawUpdates = Array.isArray(result?.answerUpdates) ? result.answerUpdates : [];
  if (!Array.isArray(result?.questions) && !Array.isArray(result?.answerUpdates)) {
    throw new Error("模型结果缺少 questions 和 answerUpdates 数组");
  }
  const normalizedQuestions: Question[] = items.map((value, index) => {
    const item = value as Record<string, unknown>;
    const type = ["single", "multiple", "fill", "answer"].includes(String(item.type)) ? String(item.type) as QuestionType : "answer";
    const id = crypto.randomUUID();
    return {
      id,
      number: String(item.number ?? index + 1),
      type,
      stem: String(item.stem ?? ""),
      options: Array.isArray(item.options) ? item.options.map((option) => {
        const entry = option as Record<string, unknown>;
        return { key: String(entry.key ?? ""), content: String(entry.content ?? "") };
      }) : undefined,
      answer: String(item.answer ?? ""),
      analysis: String(item.analysis ?? ""),
      page: Number(item.page ?? pageNumber),
      bbox: safeBox(item.bbox),
      assets: Array.isArray(item.assets) ? item.assets.map((asset, assetIndex) => {
        const entry = asset as Record<string, unknown>;
        return {
          id: id + "-asset-" + assetIndex,
          kind: ["figure", "table", "graph"].includes(String(entry.kind)) ? String(entry.kind) as "figure" | "table" | "graph" : "figure",
          label: String(entry.label ?? "题图"),
          page: Number(entry.page ?? pageNumber),
          bbox: safeBox(entry.bbox),
        };
      }) : [],
      tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 8) : [],
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
      status: Number(item.confidence ?? 0) >= .92 ? "pending" : "needs_attention",
      score: Number(item.score ?? 0),
    };
  });
  const answerUpdates = rawUpdates.map((value) => {
    const item = value as Record<string, unknown>;
    return {
      number: String(item.number ?? "").trim(),
      answer: String(item.answer ?? ""),
      analysis: String(item.analysis ?? ""),
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
    };
  }).filter((item) => item.number && (item.answer || item.analysis));
  return { questions: normalizedQuestions, answerUpdates };
}

function parseJsonContent(content: string) {
  let clean = content.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (clean.startsWith(fence)) clean = clean.slice(clean.indexOf("\n") + 1);
  if (clean.endsWith(fence)) clean = clean.slice(0, -3).trim();
  return JSON.parse(clean);
}

export async function POST(request: Request) {
  const payload = await request.json() as {
    documentId?: string; pageId?: string; pageNumber?: number; image?: string; fileName?: string;
    profileId?: string;
  };
  if (!payload.documentId || !payload.image) {
    return Response.json({ error: "documentId 和页面图像均为必填项" }, { status: 400 });
  }
  if (!payload.image.startsWith("data:image/") || payload.image.length > 30 * 1024 * 1024) {
    return Response.json({ error: "页面图像格式非法或超过 30 MB" }, { status: 413 });
  }
  const documentId = payload.documentId;
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const pageNumber = Number(payload.pageNumber ?? 1);
  const db = getDb();
  const ownedDocument = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)),
  });
  if (!ownedDocument) return Response.json({ error: "文档不存在" }, { status: 404 });
  if (payload.pageId) {
    const ownedPage = await db.query.pages.findFirst({
      where: and(eq(pages.id, payload.pageId), eq(pages.documentId, documentId)),
    });
    if (!ownedPage || ownedPage.pageNumber !== pageNumber) return Response.json({ error: "页面与文档不匹配" }, { status: 400 });
  }
  const sqlite = getSqlite();
  const runId = crypto.randomUUID();
  const createdAt = now();
  const idempotencyKey = `${documentId}:page:${pageNumber}:extract-v2`;
  const existingRun = await getDb().query.extractionRuns.findFirst({
    where: and(eq(extractionRuns.idempotencyKey, idempotencyKey), eq(extractionRuns.status, "complete")),
  });
  if (existingRun) {
    const existingQuestions = await loadPageQuestions(documentId, pageNumber);
    return Response.json({
      runId: existingRun.id, provider: existingRun.provider, model: existingRun.model,
      mode: "live", idempotentReplay: true, questions: existingQuestions,
    });
  }

  let profile;
  try {
    profile = await resolveModelProfile(ownerId, payload.profileId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型配置不可用" }, { status: 400 });
  }

  sqlite.prepare(
    `INSERT INTO extraction_runs
      (id, document_id, page_id, page_number, model_profile_id, provider, model, status, attempt, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 1, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       id = excluded.id, model_profile_id = excluded.model_profile_id, provider = excluded.provider,
       model = excluded.model, status = 'running', attempt = extraction_runs.attempt + 1,
       raw_json = NULL, error = NULL, created_at = excluded.created_at, finished_at = NULL`,
  ).run(
    runId, documentId, payload.pageId ?? null, pageNumber, profile.id,
    profile.provider, profile.model, idempotencyKey, createdAt,
  );

  try {
    const result = await callVisionModel({
      ownerId,
      profileId: profile.id,
      system: systemPrompt,
      text: "文件：" + (payload.fileName ?? "未命名试卷") + "，这是第 " + pageNumber + " 页。请提取本页所有完整题目。",
      image: payload.image,
      jsonMode: true,
    });
    const normalized = normalize(parseJsonContent(result.content), pageNumber);
    const extracted = normalized.questions;
    const finishedAt = now();
    sqliteTransaction((transaction) => {
      transaction.prepare("DELETE FROM questions WHERE document_id = ? AND page_number = ?").run(documentId, pageNumber);
      for (const question of extracted) {
        transaction.prepare(
          `INSERT INTO questions
            (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json, status, confidence, score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          question.id, documentId, question.number, question.type, question.stem,
          JSON.stringify(question.options ?? []), question.answer, question.analysis, question.page,
          JSON.stringify(question.bbox), question.status, question.confidence, question.score ?? 0, createdAt, createdAt,
        );
        for (const asset of question.assets) {
          transaction.prepare(
            `INSERT INTO question_assets (id, question_id, page_id, kind, label, source_key, bbox_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(asset.id, question.id, payload.pageId ?? null, asset.kind, asset.label, null, JSON.stringify(asset.bbox), createdAt);
        }
        for (const tagName of question.tags) {
          transaction.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(crypto.randomUUID(), tagName, createdAt);
          transaction.prepare(
            "INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
          ).run(question.id, tagName);
        }
      }
      for (const update of normalized.answerUpdates) {
        transaction.prepare(
          `UPDATE questions SET
             answer = CASE WHEN ? <> '' THEN ? ELSE answer END,
             analysis = CASE WHEN ? <> '' THEN ? ELSE analysis END,
             confidence = max(confidence, ?), updated_at = ?
           WHERE document_id = ? AND number = ?`,
        ).run(update.answer, update.answer, update.analysis, update.analysis, update.confidence, finishedAt, documentId, update.number);
      }
      transaction.prepare(
        "UPDATE extraction_runs SET status = 'complete', raw_json = ?, error = NULL, finished_at = ? WHERE idempotency_key = ?",
      ).run(result.content, finishedAt, idempotencyKey);
      transaction.prepare(
        "UPDATE documents SET status = 'reviewing', error = NULL, updated_at = ? WHERE id = ?",
      ).run(finishedAt, documentId);
    });
    return Response.json({
      runId, provider: profile.provider, model: profile.model, modelProfileId: profile.id,
      mode: "live", idempotentReplay: false, questions: extracted, answerUpdates: normalized.answerUpdates,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "识别失败";
    const finishedAt = now();
    sqliteTransaction((transaction) => {
      transaction.prepare(
        "UPDATE extraction_runs SET status = 'failed', error = ?, finished_at = ? WHERE idempotency_key = ?",
      ).run(message.slice(0, 4000), finishedAt, idempotencyKey);
      transaction.prepare("UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .run(message.slice(0, 4000), finishedAt, documentId);
    });
    return Response.json({ error: message, runId }, { status: 502 });
  }
}

async function loadPageQuestions(documentId: string, pageNumber: number): Promise<Question[]> {
  const db = getDb();
  const rows = await db.select().from(questions).where(and(eq(questions.documentId, documentId), eq(questions.pageNumber, pageNumber)));
  const ids = rows.map((row) => row.id);
  const assetRows = ids.length ? await db.select().from(assets).where(inArray(assets.questionId, ids)) : [];
  const tagRows = ids.length
    ? getSqlite().prepare(
        `SELECT qt.question_id AS questionId, t.name AS name FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
         WHERE qt.question_id IN (${ids.map(() => "?").join(",")})`,
      ).all(...ids) as Array<{ questionId: string; name: string }>
    : [] as Array<{ questionId: string; name: string }>;
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    type: row.type as QuestionType,
    stem: row.stem,
    options: JSON.parse(row.optionsJson ?? "[]") as Question["options"],
    answer: row.answer,
    analysis: row.analysis,
    page: row.pageNumber,
    bbox: JSON.parse(row.bboxJson) as BoundingBox,
    assets: assetRows.filter((asset) => asset.questionId === row.id).map((asset) => ({
      id: asset.id,
      kind: asset.kind as "figure" | "table" | "graph",
      page: row.pageNumber,
      bbox: JSON.parse(asset.bboxJson) as BoundingBox,
      label: asset.label,
    })),
    tags: tagRows.filter((tag) => tag.questionId === row.id).map((tag) => tag.name),
    confidence: row.confidence,
    status: row.status as Question["status"],
    score: row.score,
  }));
}
