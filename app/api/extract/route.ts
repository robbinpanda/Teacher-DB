import { getDb } from "../../../db";
import { assets, extractionRuns, questions } from "../../../db/schema";
import { demoQuestions } from "../../../lib/demo-data";
import { now, runtimeEnv } from "../../../lib/server";
import type { BoundingBox, Question, QuestionType } from "../../../lib/types";

const systemPrompt = [
  "你是中文中学试卷结构化专家。请只根据给出的页面图像识别题目，不补写看不清的内容。",
  "1. 将每道题题干、选项、答案、解析分开；页面没有答案或解析时填空字符串。",
  "2. 所有数学表达式改写为 LaTeX，并用单个 $ 包裹；普通中文保留原文。",
  "3. bbox 坐标使用页面宽高百分比，范围 0-100，分别为 x,y,width,height。",
  "4. question bbox 覆盖完整题目。assets 只框真正需要随题保存的图、表、函数图象，不要把题干文字放进题图。",
  "5. type 只能是 single、multiple、fill、answer。",
  "6. 不要输出 Markdown，只输出严格 JSON。",
  "JSON 格式：",
  "{\"questions\":[{\"number\":\"1\",\"type\":\"single\",\"stem\":\"题干，公式如 $x^2$\",\"options\":[{\"key\":\"A\",\"content\":\"选项\"}],\"answer\":\"\",\"analysis\":\"\",\"page\":1,\"bbox\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0},\"assets\":[{\"kind\":\"figure\",\"label\":\"图的说明\",\"page\":1,\"bbox\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0}}],\"tags\":[\"建议知识点\"],\"confidence\":0.95,\"score\":3}]}",
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

function normalize(raw: unknown, pageNumber: number): Question[] {
  const items = (raw as { questions?: unknown[] })?.questions;
  if (!Array.isArray(items)) throw new Error("模型结果缺少 questions 数组");
  return items.map((value, index) => {
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
}

function parseJsonContent(content: string) {
  let clean = content.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (clean.startsWith(fence)) clean = clean.slice(clean.indexOf("\n") + 1);
  if (clean.endsWith(fence)) clean = clean.slice(0, -3).trim();
  return JSON.parse(clean);
}

export async function POST(request: Request) {
  const payload = await request.json() as { documentId?: string; pageNumber?: number; image?: string; fileName?: string };
  const pageNumber = Number(payload.pageNumber ?? 1);
  const bindings = runtimeEnv();
  const runId = crypto.randomUUID();
  const createdAt = now();
  let extracted: Question[];
  let provider = "demo";
  let model = "built-in-demo";
  let rawJson = "";

  try {
    if (bindings.VISION_API_KEY && bindings.VISION_API_BASE_URL && payload.image) {
      provider = "openai-compatible";
      model = bindings.VISION_MODEL ?? "gpt-4.1-mini";
      const endpoint = bindings.VISION_API_BASE_URL.replace(/\/$/, "") + "/chat/completions";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: "Bearer " + bindings.VISION_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          reasoning_effort: "none",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: [
              { type: "text", text: "文件：" + (payload.fileName ?? "未命名试卷") + "，这是第 " + pageNumber + " 页。请提取本页所有完整题目。" },
              { type: "image_url", image_url: { url: payload.image, detail: "high" } },
            ] },
          ],
        }),
      });
      if (!response.ok) throw new Error("视觉模型返回 " + response.status + "：" + await response.text());
      const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      rawJson = result.choices?.[0]?.message?.content ?? "";
      extracted = normalize(parseJsonContent(rawJson), pageNumber);
    } else {
      extracted = demoQuestions.slice(0, 4).map((question) => ({ ...question, id: crypto.randomUUID() }));
      rawJson = JSON.stringify({ questions: extracted });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "识别失败", runId }, { status: 502 });
  }

  if (payload.documentId) {
    try {
      const db = getDb();
      await db.insert(extractionRuns).values({ id: runId, documentId: payload.documentId, provider, model, status: "complete", rawJson, createdAt });
      for (const question of extracted) {
        await db.insert(questions).values({
          id: question.id,
          documentId: payload.documentId,
          number: question.number,
          type: question.type,
          stem: question.stem,
          optionsJson: JSON.stringify(question.options ?? []),
          answer: question.answer,
          analysis: question.analysis,
          pageNumber: question.page,
          bboxJson: JSON.stringify(question.bbox),
          status: question.status,
          confidence: question.confidence,
          score: question.score ?? 0,
          createdAt,
          updatedAt: createdAt,
        });
        for (const asset of question.assets) {
          await db.insert(assets).values({ id: asset.id, questionId: question.id, kind: asset.kind, label: asset.label, bboxJson: JSON.stringify(asset.bbox), createdAt });
        }
      }
    } catch (error) {
      console.warn("Extraction persistence is unavailable in preview.", error);
    }
  }
  return Response.json({ runId, provider, model, mode: provider === "demo" ? "demo" : "live", questions: extracted });
}
