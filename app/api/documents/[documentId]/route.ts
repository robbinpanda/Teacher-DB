import { and, eq, sql } from "drizzle-orm";
import { getDb, getSqlite, sqliteTransaction } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { documents, questions } from "../../../../db/schema";
import { deleteFile } from "../../../../lib/file-storage";
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
    error?: string | null;
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
    const pageProgress = getSqlite().prepare(
      `SELECT COUNT(p.id) AS total,
              COALESCE(SUM(CASE WHEN r.status = 'complete' THEN 1 ELSE 0 END), 0) AS complete
         FROM pages p LEFT JOIN extraction_runs r
           ON r.idempotency_key = p.document_id || ':page:' || p.page_number || ':extract-v3'
        WHERE p.document_id = ?`,
    ).get(documentId) as { total: number; complete: number };
    const missingPages = Math.max(0, document.pageCount - pageProgress.total);
    const incompletePages = missingPages + pageProgress.total - pageProgress.complete;
    if (incompletePages > 0) {
      return Response.json({ error: `还有 ${incompletePages} 页未完成识别，不能完成入库` }, { status: 409 });
    }
  }

  const allowedStatuses = new Set(["uploading", "extracting", "reviewing", "failed", "complete"]);
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
    ...(payload.error !== undefined ? { error: payload.error?.slice(0, 4000) || null } : {}),
    updatedAt: now(),
  }).where(and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)));

  return Response.json({ saved: true, status: payload.status ?? document.status });
}

export async function DELETE(request: Request, context: { params: Promise<{ documentId: string }> }) {
  await ensureDatabase();
  const { documentId } = await context.params;
  const ownerId = requestOwner(request);
  const payload = await request.json().catch(() => ({})) as { mode?: "with_questions" | "source_only" };
  if (!new Set(["with_questions", "source_only"]).has(payload.mode ?? "")) {
    return Response.json({ error: "请选择删除方式" }, { status: 400 });
  }
  const sqlite = getSqlite();
  const document = sqlite.prepare(
    `SELECT id, original_key AS originalKey, source_removed_at AS sourceRemovedAt
       FROM documents WHERE id = ? AND owner_id = ?`,
  ).get(documentId, ownerId) as { id: string; originalKey: string | null; sourceRemovedAt: string | null } | undefined;
  if (!document || document.sourceRemovedAt) return Response.json({ error: "试卷不存在或已删除" }, { status: 404 });
  const pageKeys = sqlite.prepare("SELECT storage_key AS storageKey FROM pages WHERE document_id = ?")
    .all(documentId) as Array<{ storageKey: string }>;
  const cropKeys = payload.mode === "with_questions"
    ? sqlite.prepare(
        `SELECT a.crop_key AS cropKey FROM question_assets a
          JOIN questions q ON q.id = a.question_id
         WHERE q.document_id = ? AND a.crop_key IS NOT NULL`,
      ).all(documentId) as Array<{ cropKey: string }>
    : [];
  const fileKeys = Array.from(new Set([
    document.originalKey,
    ...pageKeys.map((page) => page.storageKey),
    ...cropKeys.map((asset) => asset.cropKey),
  ].filter((key): key is string => Boolean(key))));
  const timestamp = now();
  if (payload.mode === "with_questions") {
    sqliteTransaction((transaction) => {
      transaction.prepare(
        `DELETE FROM paper_items WHERE question_id IN (SELECT id FROM questions WHERE document_id = ?)`,
      ).run(documentId);
      transaction.prepare("DELETE FROM documents WHERE id = ? AND owner_id = ?").run(documentId, ownerId);
      transaction.prepare("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM question_tags)").run();
    });
  } else {
    sqliteTransaction((transaction) => {
      transaction.prepare("DELETE FROM document_jobs WHERE document_id = ?").run(documentId);
      transaction.prepare("DELETE FROM extraction_runs WHERE document_id = ?").run(documentId);
      transaction.prepare("DELETE FROM pages WHERE document_id = ?").run(documentId);
      transaction.prepare(
        `UPDATE documents SET original_key = NULL, source_removed_at = ?, updated_at = ?
          WHERE id = ? AND owner_id = ?`,
      ).run(timestamp, timestamp, documentId, ownerId);
    });
  }
  const removedFiles = await Promise.allSettled(fileKeys.map((key) => deleteFile(key)));
  const fileDeleteFailures = removedFiles.filter((result) => result.status === "rejected").length;
  return Response.json({
    deleted: true,
    mode: payload.mode,
    questionsRetained: payload.mode === "source_only",
    fileDeleteFailures,
  });
}
