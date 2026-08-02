import { and, eq } from "drizzle-orm";
import { getDb, getSqlite } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { documents, questions } from "../../../../../db/schema";
import { now, requestOwner } from "../../../../../lib/server";

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
  const maxNumber = getSqlite().prepare(
    "SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) AS value FROM questions WHERE document_id = ?",
  ).get(documentId) as { value: number };
  const id = crypto.randomUUID();
  const timestamp = now();
  const number = String(maxNumber.value + 1);
  await db.insert(questions).values({
    id,
    documentId,
    number,
    type: "answer",
    stem: "请在此输入题干",
    optionsJson: "[]",
    answer: "",
    analysis: "",
    pageNumber: page,
    bboxJson: JSON.stringify({ x: 5, y: 5, width: 90, height: 20 }),
    status: "pending",
    confidence: 1,
    score: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
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
      assets: [],
      tags: [],
      confidence: 1,
      status: "pending",
      score: 0,
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
