import { getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { now, requestOwner } from "../../../../../lib/server";
import { callVisionModel, ModelCallError } from "../../../../../lib/vision-model";

export const runtime = "nodejs";

function parseJsonContent(content: string) {
  let clean = content.trim();
  if (clean.startsWith("```")) clean = clean.slice(clean.indexOf("\n") + 1);
  if (clean.endsWith("```")) clean = clean.slice(0, -3).trim();
  try { return JSON.parse(clean) as Record<string, unknown>; }
  catch { return JSON.parse(clean.replace(/(?<!\\)\\(?!["\\])/g, "\\\\")) as Record<string, unknown>; }
}

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const payload = await request.json() as { sourceName?: string; images?: Array<{ page: number; dataUrl: string }>; importId?: string; final?: boolean; profileId?: string };
  const images = (payload.images ?? []).slice(0, 6);
  if (!images.length || images.some((item) => !item.dataUrl.startsWith("data:image/") || item.dataUrl.length > 12 * 1024 * 1024)) {
    return Response.json({ error: "答案页为空、格式无效或单页超过 12 MB" }, { status: 400 });
  }
  const sqlite = getSqlite();
  const document = sqlite.prepare("SELECT id FROM documents WHERE id = ? AND owner_id = ? AND source_removed_at IS NULL").get(documentId, ownerId);
  if (!document) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const questions = sqlite.prepare(
    "SELECT id, number, stem, answer FROM questions WHERE document_id = ? AND status = 'approved' ORDER BY CAST(number AS INTEGER)",
  ).all(documentId) as Array<{ id: string; number: string; stem: string; answer: string }>;
  if (!questions.length) return Response.json({ error: "请先审核并入库题目，再补录答案" }, { status: 409 });
  const questionByNumber = new Map(questions.map((question) => [question.number, question]));
  const importId = payload.importId?.trim() || crypto.randomUUID();
  const timestamp = now();
  if (!payload.importId) {
    sqlite.prepare("INSERT INTO answer_imports (id, owner_id, document_id, source_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'processing', ?, ?)")
      .run(importId, ownerId, documentId, (payload.sourceName || "答案文件").slice(0, 180), timestamp, timestamp);
  } else {
    const owned = sqlite.prepare("SELECT id FROM answer_imports WHERE id = ? AND owner_id = ? AND document_id = ?").get(importId, ownerId, documentId);
    if (!owned) return Response.json({ error: "答案导入任务不存在" }, { status: 404 });
  }

  try {
    const result = await callVisionModel({
      ownerId,
      profileId: payload.profileId,
      purpose: "answer_import",
      documentId,
      system: [
        "你是答案页匹配专家。只读取图片中明确可见的答案和解析，并匹配到给定题号。",
        "不得创造题号；没有明确答案的题不要输出。若页面重复出现同题，合并更完整的答案和解析。",
        "answer 与 analysis 必须逐字、逐符号按原文顺序转录，完整保留每个小问、推导步骤、条件、单位、标点和结论。严禁概括、改写、缩写、润色、合并步骤或用自己的话总结；看不清的部分不要猜测。",
        "数学表达式转为用单个 $ 包裹的 LaTeX。只返回严格 JSON。",
        "格式：{\"matches\":[{\"number\":\"1\",\"answer\":\"\",\"analysis\":\"\",\"confidence\":0.96}],\"unmatchedNotes\":[\"无法确认的内容\"]}",
      ].join("\n"),
      text: `目标题目如下：${JSON.stringify(questions.map((question) => ({ number: question.number, stem: question.stem.slice(0, 180) })))}。当前是答案文件 ${payload.sourceName || "未命名"} 的部分页面。`,
      images,
      jsonMode: true,
    });
    const parsed = parseJsonContent(result.content);
    const rawMatches = Array.isArray(parsed.matches) ? parsed.matches : [];
    const unknownNumbers = new Set<string>();
    const matches = rawMatches.flatMap((value) => {
      const item = value as Record<string, unknown>;
      const number = String(item.number ?? "").trim();
      const target = questionByNumber.get(number);
      if (!target) { if (number) unknownNumbers.add(number); return []; }
      const answer = String(item.answer ?? "").trim();
      const analysis = String(item.analysis ?? "").trim();
      return answer || analysis ? [{ id: target.id, number, answer, analysis, confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))) }] : [];
    });
    sqliteTransaction((transaction) => {
      for (const match of matches) {
        transaction.prepare(
          `UPDATE questions SET answer = CASE WHEN ? <> '' THEN ? ELSE answer END,
             analysis = CASE WHEN ? <> '' THEN ? ELSE analysis END, updated_at = ? WHERE id = ?`,
        ).run(match.answer, match.answer, match.analysis, match.analysis, timestamp, match.id);
      }
      const previous = transaction.prepare("SELECT result_json AS resultJson FROM answer_imports WHERE id = ?").get(importId) as { resultJson: string | null };
      let accumulated: Array<{ number: string }> = [];
      try { accumulated = JSON.parse(previous.resultJson || "[]") as Array<{ number: string }>; } catch { accumulated = []; }
      const merged = [...accumulated, ...matches].filter((item, index, all) => all.findIndex((candidate) => candidate.number === item.number) === index);
      transaction.prepare("UPDATE answer_imports SET status = ?, result_json = ?, error = NULL, updated_at = ? WHERE id = ?")
        .run(payload.final ? "complete" : "processing", JSON.stringify(merged), timestamp, importId);
    });
    const missing = sqlite.prepare("SELECT number FROM questions WHERE document_id = ? AND status = 'approved' AND TRIM(answer) = '' ORDER BY CAST(number AS INTEGER)").all(documentId) as Array<{ number: string }>;
    return Response.json({
      importId,
      matches,
      lowConfidenceNumbers: matches.filter((match) => match.confidence < 0.82).map((match) => match.number),
      unknownNumbers: [...unknownNumbers],
      unmatchedNotes: Array.isArray(parsed.unmatchedNotes) ? parsed.unmatchedNotes.map(String).slice(0, 10) : [],
      missingNumbers: missing.map((item) => item.number),
      final: Boolean(payload.final),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "答案识别失败";
    sqlite.prepare("UPDATE answer_imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message, now(), importId);
    return Response.json({ error: message, importId, code: error instanceof ModelCallError ? error.code : "answer_import_error", retryable: error instanceof ModelCallError ? error.retryable : true }, { status: 502 });
  }
}
