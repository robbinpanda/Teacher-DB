import type Database from "better-sqlite3";

export function installDatabaseInvariants(sqlite: Database.Database) {
  sqlite.exec(`CREATE TRIGGER IF NOT EXISTS approved_questions_are_reviewed_after_insert
    AFTER INSERT ON questions
    WHEN NEW.status = 'approved' AND COALESCE(NEW.needs_human_review, 1) <> 0
    BEGIN
      UPDATE questions SET needs_human_review = 0 WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS approved_questions_are_reviewed_after_update
    AFTER UPDATE OF status, needs_human_review ON questions
    WHEN NEW.status = 'approved' AND COALESCE(NEW.needs_human_review, 1) <> 0
    BEGIN
      UPDATE questions SET needs_human_review = 0 WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS documents_failed_unapproves_questions
    AFTER UPDATE OF status ON documents
    WHEN NEW.status = 'failed' AND OLD.status <> 'failed'
    BEGIN
      UPDATE questions SET status = 'needs_attention', needs_human_review = 1, updated_at = NEW.updated_at
       WHERE document_id = NEW.id AND status = 'approved';
    END`);
}

export function repairApprovedQuestionReviewFlags(sqlite: Database.Database) {
  return sqlite.prepare(
    `UPDATE questions SET needs_human_review = 0
      WHERE status = 'approved' AND COALESCE(needs_human_review, 1) <> 0`,
  ).run().changes;
}

export function repairFailedDocumentApprovals(sqlite: Database.Database, timestamp: string) {
  return sqlite.prepare(
    `UPDATE questions SET status = 'needs_attention', needs_human_review = 1, updated_at = ?
      WHERE status = 'approved' AND document_id IN (SELECT id FROM documents WHERE status = 'failed')`,
  ).run(timestamp).changes;
}
