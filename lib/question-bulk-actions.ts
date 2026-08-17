import type Database from "better-sqlite3";

export class QuestionBulkActionError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "QuestionBulkActionError";
    this.status = status;
  }
}

export function normalizeQuestionIds(value: unknown) {
  if (!Array.isArray(value)) throw new QuestionBulkActionError("请选择要删除的题目", 400);
  const questionIds = Array.from(new Set(value.map(String).map((id) => id.trim()).filter(Boolean)));
  if (!questionIds.length) throw new QuestionBulkActionError("请至少选择一道题", 400);
  if (questionIds.length > 500) throw new QuestionBulkActionError("一次最多删除 500 道题", 400);
  return questionIds;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

export function deleteQuestions(
  sqlite: Database.Database,
  input: { ownerId: string; questionIds: string[]; timestamp: string },
) {
  const marks = placeholders(input.questionIds.length);
  const rows = sqlite.prepare(
    `SELECT q.id, q.document_id AS documentId
       FROM questions q JOIN documents d ON d.id = q.document_id
      WHERE d.owner_id = ? AND q.id IN (${marks})`,
  ).all(input.ownerId, ...input.questionIds) as Array<{ id: string; documentId: string }>;
  if (rows.length !== input.questionIds.length) {
    throw new QuestionBulkActionError("选中的题目已不存在或无权操作", 404);
  }

  const cropRows = sqlite.prepare(
    `SELECT crop_key AS cropKey FROM question_assets
      WHERE question_id IN (${marks}) AND crop_key IS NOT NULL`,
  ).all(...input.questionIds) as Array<{ cropKey: string }>;
  const documentIds = Array.from(new Set(rows.map((row) => row.documentId)));
  const documentMarks = placeholders(documentIds.length);

  sqlite.prepare(`DELETE FROM paper_items WHERE question_id IN (${marks})`).run(...input.questionIds);
  const deleted = sqlite.prepare(
    `DELETE FROM questions WHERE id IN (${marks})
       AND document_id IN (SELECT id FROM documents WHERE owner_id = ?)`,
  ).run(...input.questionIds, input.ownerId).changes;
  sqlite.prepare("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM question_tags)").run();
  sqlite.prepare(
    `UPDATE documents SET status = CASE WHEN source_removed_at IS NULL THEN 'reviewing' ELSE status END,
       updated_at = ? WHERE id IN (${documentMarks})`,
  ).run(input.timestamp, ...documentIds);

  return {
    deleted,
    documentIds,
    fileKeys: Array.from(new Set(cropRows.map((row) => row.cropKey))),
  };
}
