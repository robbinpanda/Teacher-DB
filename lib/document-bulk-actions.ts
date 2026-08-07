import type Database from "better-sqlite3";

export type BulkDeleteMode = "with_questions" | "source_only";

export class DocumentBulkActionError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "DocumentBulkActionError";
    this.status = status;
  }
}

export function normalizeDocumentIds(value: unknown) {
  if (!Array.isArray(value)) throw new DocumentBulkActionError("请选择要处理的试卷", 400);
  const documentIds = Array.from(new Set(value.map(String).map((id) => id.trim()).filter(Boolean)));
  if (!documentIds.length) throw new DocumentBulkActionError("请至少选择一份试卷", 400);
  if (documentIds.length > 100) throw new DocumentBulkActionError("一次最多处理 100 份试卷", 400);
  return documentIds;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

function ownedDocuments(sqlite: Database.Database, ownerId: string, documentIds: string[]) {
  const rows = sqlite.prepare(
    `SELECT id, name, status, source_removed_at AS sourceRemovedAt
       FROM documents WHERE owner_id = ? AND id IN (${placeholders(documentIds.length)})`,
  ).all(ownerId, ...documentIds) as Array<{ id: string; name: string; status: string; sourceRemovedAt: string | null }>;
  if (rows.length !== documentIds.length) throw new DocumentBulkActionError("选中的试卷已不存在或无权操作", 404);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return documentIds.map((id) => byId.get(id)!);
}

export function approveDocumentsWithoutReview(
  sqlite: Database.Database,
  input: {
    ownerId: string;
    documentIds: string[];
    timestamp: string;
    reviewReadinessError: (documentId: string) => string | null;
  },
) {
  const selected = ownedDocuments(sqlite, input.ownerId, input.documentIds);
  for (const document of selected) {
    if (document.sourceRemovedAt) throw new DocumentBulkActionError(`《${document.name}》原试卷已删除，无法再修改题目`);
    if (document.status !== "reviewing") throw new DocumentBulkActionError(`《${document.name}》尚未进入待审核状态`);
    const readinessError = input.reviewReadinessError(document.id);
    if (readinessError) throw new DocumentBulkActionError(`《${document.name}》：${readinessError}`);
  }

  let changed = 0;
  const documents = selected.map((document) => {
    changed += sqlite.prepare(
      `UPDATE questions SET status = 'approved', updated_at = ?
        WHERE document_id = ? AND needs_human_review = 0 AND status = 'pending'`,
    ).run(input.timestamp, document.id).changes;
    const counts = sqlite.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
              COALESCE(SUM(CASE WHEN status <> 'approved' AND (needs_human_review IS NULL OR needs_human_review <> 0) THEN 1 ELSE 0 END), 0) AS reviewRequired
         FROM questions WHERE document_id = ?`,
    ).get(document.id) as { total: number; approved: number; reviewRequired: number };
    const status = counts.total > 0 && counts.approved === counts.total ? "complete" : "reviewing";
    sqlite.prepare("UPDATE documents SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, input.timestamp, document.id);
    return { id: document.id, status, ...counts };
  });
  return { changed, documents };
}

export function deleteDocuments(
  sqlite: Database.Database,
  input: { ownerId: string; documentIds: string[]; mode: BulkDeleteMode; timestamp: string },
) {
  const selected = ownedDocuments(sqlite, input.ownerId, input.documentIds);
  const removed = selected.find((document) => document.sourceRemovedAt);
  if (removed) throw new DocumentBulkActionError(`《${removed.name}》试卷来源已被删除`);
  const ids = selected.map((document) => document.id);
  const marks = placeholders(ids.length);
  const originals = sqlite.prepare(
    `SELECT original_key AS storageKey FROM documents WHERE id IN (${marks}) AND original_key IS NOT NULL`,
  ).all(...ids) as Array<{ storageKey: string }>;
  const pages = sqlite.prepare(
    `SELECT storage_key AS storageKey FROM pages WHERE document_id IN (${marks})`,
  ).all(...ids) as Array<{ storageKey: string }>;
  const crops = input.mode === "with_questions"
    ? sqlite.prepare(
        `SELECT a.crop_key AS storageKey FROM question_assets a
          JOIN questions q ON q.id = a.question_id
         WHERE q.document_id IN (${marks}) AND a.crop_key IS NOT NULL`,
      ).all(...ids) as Array<{ storageKey: string }>
    : [];
  const fileKeys = Array.from(new Set([...originals, ...pages, ...crops].map((row) => row.storageKey)));

  if (input.mode === "with_questions") {
    sqlite.prepare(
      `DELETE FROM paper_items WHERE question_id IN (
         SELECT id FROM questions WHERE document_id IN (${marks})
       )`,
    ).run(...ids);
    sqlite.prepare(`DELETE FROM documents WHERE owner_id = ? AND id IN (${marks})`).run(input.ownerId, ...ids);
    sqlite.prepare("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM question_tags)").run();
  } else {
    sqlite.prepare(`DELETE FROM document_jobs WHERE document_id IN (${marks})`).run(...ids);
    sqlite.prepare(`DELETE FROM extraction_runs WHERE document_id IN (${marks})`).run(...ids);
    sqlite.prepare(`DELETE FROM pages WHERE document_id IN (${marks})`).run(...ids);
    sqlite.prepare(
      `UPDATE documents SET original_key = NULL, source_removed_at = ?, updated_at = ?
        WHERE owner_id = ? AND id IN (${marks})`,
    ).run(input.timestamp, input.timestamp, input.ownerId, ...ids);
  }
  return { deleted: ids.length, fileKeys };
}
