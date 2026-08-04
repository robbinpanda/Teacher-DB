import sharp from "sharp";
import { getSqlite } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { getFile } from "../../../../../lib/file-storage";
import { requestOwner } from "../../../../../lib/server";
import type { BoundingBox, QuestionType } from "../../../../../lib/types";
import { callVisionModel, ModelCallError } from "../../../../../lib/vision-model";

export const runtime = "nodejs";

type RequestedRegion = { page: number; bbox: BoundingBox };

function safeBox(value: BoundingBox): BoundingBox {
  const x = Math.max(0, Math.min(99.9, Number(value?.x) || 0));
  const y = Math.max(0, Math.min(99.9, Number(value?.y) || 0));
  return {
    x,
    y,
    width: Math.max(0.1, Math.min(100 - x, Number(value?.width) || 0.1)),
    height: Math.max(0.1, Math.min(100 - y, Number(value?.height) || 0.1)),
  };
}

function parseJsonContent(content: string) {
  let clean = content.trim();
  const fence = "```";
  if (clean.startsWith(fence)) clean = clean.slice(clean.indexOf("\n") + 1);
  if (clean.endsWith(fence)) clean = clean.slice(0, -3).trim();
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch (firstError) {
    const repaired = clean.replace(/(?<!\\)\\(?!["\\])/g, "\\\\");
    if (repaired === clean) throw firstError;
    return JSON.parse(repaired) as Record<string, unknown>;
  }
}

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  await ensureDatabase();
  const { questionId } = await context.params;
  const ownerId = requestOwner(request);
  const payload = await request.json() as { regions?: RequestedRegion[]; profileId?: string };
  const sqlite = getSqlite();
  const question = sqlite.prepare(
    `SELECT q.document_id AS documentId, q.number, q.type
       FROM questions q JOIN documents d ON d.id = q.document_id
      WHERE q.id = ? AND d.owner_id = ?`,
  ).get(questionId, ownerId) as { documentId: string; number: string; type: string } | undefined;
  if (!question) return Response.json({ error: "题目不存在" }, { status: 404 });

  const requested = Array.isArray(payload.regions) ? payload.regions.slice(0, 12) : [];
  if (!requested.length) return Response.json({ error: "请先框选题目范围" }, { status: 400 });
  const uniqueRegions = requested
    .filter((region, index, all) => Boolean(region?.bbox)
      && Number.isInteger(Number(region?.page))
      && all.findIndex((item) => Number(item?.page) === Number(region?.page)) === index)
    .map((region) => ({ page: Number(region.page), bbox: safeBox(region.bbox) }))
    .sort((left, right) => left.page - right.page);

  try {
    const images: Array<{ page: number; dataUrl: string }> = [];
    for (const region of uniqueRegions) {
      const page = sqlite.prepare(
        `SELECT storage_key AS storageKey FROM pages WHERE document_id = ? AND page_number = ?`,
      ).get(question.documentId, region.page) as { storageKey: string } | undefined;
      if (!page) return Response.json({ error: `找不到第 ${region.page} 页原图` }, { status: 422 });
      const sourceBytes = await getFile(page.storageKey);
      const image = sharp(sourceBytes, { failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) throw new Error(`无法读取第 ${region.page} 页图像尺寸`);
      const left = Math.min(metadata.width - 1, Math.max(0, Math.floor(metadata.width * region.bbox.x / 100)));
      const top = Math.min(metadata.height - 1, Math.max(0, Math.floor(metadata.height * region.bbox.y / 100)));
      const width = Math.max(1, Math.min(metadata.width - left, Math.round(metadata.width * region.bbox.width / 100)));
      const height = Math.max(1, Math.min(metadata.height - top, Math.round(metadata.height * region.bbox.height / 100)));
      const crop = await image.extract({ left, top, width, height })
        .resize({ width: 1800, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      images.push({ page: region.page, dataUrl: `data:image/jpeg;base64,${crop.toString("base64")}` });
    }

    const result = await callVisionModel({
      ownerId,
      profileId: payload.profileId,
      system: [
        "你是中文中学试题转录专家。用户已人工校正题目框，所有图片按页码顺序组成同一道题。",
        "只转录框内确实可见的内容，并把跨页内容按阅读顺序合并。禁止补写框外或不可见文字。",
        "一道大题包含（1）（2）或【小问1详解】【小问2详解】时，必须读取并合并所有小问；【小问1详解】绝不代表整道大题结束，必须继续检查后续图片，直到下一独立顶层题号之前。",
        "输出前逐项核对题干中的每个小问编号在答案和解析中是否完整出现，不得只返回第一小问。",
        "严格区分题干、选项、答案和解析；没有答案或解析时返回空字符串。数学表达式使用单个 $ 包裹的 LaTeX。",
        "只返回严格 JSON，不要 Markdown 或解释。",
        "格式：{\"type\":\"single|multiple|fill|answer\",\"stem\":\"\",\"options\":[{\"key\":\"A\",\"content\":\"\"}],\"answer\":\"\",\"analysis\":\"\",\"tags\":[\"知识点\"],\"confidence\":0.95}",
      ].join("\n"),
      text: `这是第 ${question.number} 题，原题型为 ${question.type}。请根据 ${uniqueRegions.length} 个已校正题框重新识别完整内容。`,
      images,
      jsonMode: true,
    });
    const parsed = parseJsonContent(result.content);
    const stem = String(parsed.stem ?? "").trim();
    if (!stem) return Response.json({ error: "新题框内未识别到题干，请继续调整框选范围" }, { status: 422 });
    const type = ["single", "multiple", "fill", "answer"].includes(String(parsed.type))
      ? String(parsed.type) as QuestionType
      : question.type as QuestionType;
    const options = Array.isArray(parsed.options) ? parsed.options.map((value) => {
      const option = value as Record<string, unknown>;
      return { key: String(option.key ?? "").trim(), content: String(option.content ?? "").trim() };
    }).filter((option) => option.key || option.content) : [];
    return Response.json({
      recognition: {
        type,
        stem,
        options: ["single", "multiple"].includes(type) ? options : [],
        answer: String(parsed.answer ?? "").trim(),
        analysis: String(parsed.analysis ?? "").trim(),
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8) : [],
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
      },
      provider: result.profile.provider,
      model: result.profile.model,
      regions: uniqueRegions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重新识别失败";
    return Response.json({
      error: message,
      code: error instanceof ModelCallError ? error.code : "reextract_error",
      retryable: error instanceof ModelCallError ? error.retryable : true,
    }, { status: 502 });
  }
}
