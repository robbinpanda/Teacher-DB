import { and, eq } from "drizzle-orm";
import { getDb, getSqlite, sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { documents } from "../../../../../db/schema";
import { now, requestOwner } from "../../../../../lib/server";
import { missingPositiveNumbers } from "../../../../../lib/document-integrity";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const db = getDb();
  const document = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)),
  });
  if (!document) return Response.json({ error: "文档不存在" }, { status: 404 });
  const payload = await request.json().catch(() => ({})) as { page?: number };
  const page = Math.max(1, Math.min(document.pageCount || 1, Number(payload.page ?? 1)));
  const pageExists = getSqlite().prepare("SELECT 1 FROM pages WHERE document_id = ? AND page_number = ?").get(documentId, page);
  if (!pageExists) return Response.json({ error: "页面不存在" }, { status: 400 });
  const sqlite = getSqlite();
  const existingNumbers = (sqlite.prepare(
    "SELECT number FROM questions WHERE document_id = ? ORDER BY CAST(number AS INTEGER)",
  ).all(documentId) as Array<{ number: string }>).map((row) => row.number);
  const numericNumbers = existingNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0);
  const number = String(missingPositiveNumbers(numericNumbers)[0] ?? ((numericNumbers.at(-1) ?? 0) + 1));
  const id = crypto.randomUUID();
  const timestamp = now();
  const initialBox = { x: 5, y: 5, width: 90, height: 20 };
  sqliteTransaction((transaction) => {
    transaction.prepare(
      `INSERT INTO questions
        (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json,
         status, needs_human_review, confidence, score, created_at, updated_at)
       VALUES (?, ?, ?, 'answer', '请在此输入题干', '[]', '', '', ?, ?, 'needs_attention', 1, 1, 0, ?, ?)`,
    ).run(id, documentId, number, page, JSON.stringify(initialBox), timestamp, timestamp);
    transaction.prepare(
      `INSERT INTO question_regions (id, question_id, page_id, page_number, bbox_json, position, created_at)
       SELECT ?, ?, id, ?, ?, 0, ? FROM pages WHERE document_id = ? AND page_number = ?`,
    ).run(crypto.randomUUID(), id, page, JSON.stringify(initialBox), timestamp, documentId, page);
  });
  return Response.json({
    question: {
      id,
      number,
      type: "answer",
      stem: "请在此输入题干",
      options: [],
      answer: "",
      analysis: "",
      page,
      bbox: { x: 5, y: 5, width: 90, height: 20 },
      regions: [{ page, bbox: { x: 5, y: 5, width: 90, height: 20 } }],
      assets: [],
      tags: [],
      confidence: 1,
      needsHumanReview: true,
      status: "needs_attention",
      source: {
        documentId,
        documentName: document.name,
        subject: document.subject ?? "未设置学科",
        grade: document.grade ?? "未设置年级",
        year: document.sourceYear,
        examType: document.sourceExamType,
        region: document.sourceRegion,
        school: document.sourceSchool,
      },
    },
  }, { status: 201 });
}
