import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { documents, questions } from "../../../../db/schema";
import { now, requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const payload = await request.json() as {
    status?: string;
    subject?: string;
    grade?: string;
    year?: number | null;
    examType?: string | null;
    region?: string | null;
    school?: string | null;
  };
  const db = getDb();
  const document = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)),
  });
  if (!document) return Response.json({ error: "文档不存在" }, { status: 404 });

  if (payload.status === "complete") {
    const [counts] = await db.select({
      total: sql<number>`count(*)`,
      approved: sql<number>`coalesce(sum(case when ${questions.status} = 'approved' then 1 else 0 end), 0)`,
    }).from(questions).where(eq(questions.documentId, documentId));
    if (!counts.total) return Response.json({ error: "还没有可入库的题目" }, { status: 409 });
    if (counts.approved !== counts.total) {
      return Response.json({ error: `还有 ${counts.total - counts.approved} 道题未审核，不能完成入库` }, { status: 409 });
    }
  }

  const allowedStatuses = new Set(["uploading", "extracting", "reviewing", "complete"]);
  if (payload.status && !allowedStatuses.has(payload.status)) {
    return Response.json({ error: "非法文档状态" }, { status: 400 });
  }
  await db.update(documents).set({
    ...(payload.status ? { status: payload.status } : {}),
    ...(payload.subject !== undefined ? { subject: payload.subject || null } : {}),
    ...(payload.grade !== undefined ? { grade: payload.grade || null } : {}),
    ...(payload.year !== undefined ? { sourceYear: payload.year } : {}),
    ...(payload.examType !== undefined ? { sourceExamType: payload.examType || null } : {}),
    ...(payload.region !== undefined ? { sourceRegion: payload.region || null } : {}),
    ...(payload.school !== undefined ? { sourceSchool: payload.school || null } : {}),
    updatedAt: now(),
  }).where(and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)));

  return Response.json({ saved: true, status: payload.status ?? document.status });
}
