import type Database from "better-sqlite3";
import { getSqlite, sqliteTransaction } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { getDocumentIntegrity } from "./document-integrity";

export function clearDocumentReviewRequirements(sqlite: Database.Database, documentId: string, timestamp: string) {
  // Keep diagnostic evidence, but invalidate pending verdicts so late replies cannot restore review requirements.
  sqlite.prepare(`UPDATE questions SET needs_human_review=0, status='pending', updated_at=?,
    ai_review_json=CASE WHEN json_valid(ai_review_json) AND json_extract(ai_review_json, '$.status')='pending'
      THEN json_set(ai_review_json, '$.status', 'stale') ELSE ai_review_json END
    WHERE document_id=? AND status<>'approved'`).run(timestamp, documentId);
}

// Callers of this synchronous read have already initialized the database.
export function automaticAiReviewEnabled(ownerId: string) {
  const row = getSqlite().prepare("SELECT automatic_ai_review_enabled AS enabled FROM app_settings WHERE owner_id = ?")
    .get(ownerId) as { enabled: number } | undefined;
  return row?.enabled === 1;
}

export async function setAutomaticAiReviewEnabled(ownerId: string, enabled: boolean) {
  await ensureDatabase();
  const timestamp = new Date().toISOString();
  sqliteTransaction((sqlite) => {
    sqlite.prepare(`INSERT INTO app_settings (owner_id, automatic_ai_review_enabled, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET automatic_ai_review_enabled = excluded.automatic_ai_review_enabled, updated_at = excluded.updated_at`)
      .run(ownerId, enabled ? 1 : 0, timestamp);
    if (enabled) return;
    const documents = sqlite.prepare(`SELECT id FROM documents WHERE owner_id=? AND status='reviewing'
      AND source_removed_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM document_jobs WHERE document_id=documents.id AND status IN ('processing','queued','retry_wait'))`)
      .all(ownerId) as Array<{ id: string }>;
    for (const document of documents) {
      if (getDocumentIntegrity(sqlite, document.id)?.reviewReady) clearDocumentReviewRequirements(sqlite, document.id, timestamp);
    }
  });
}
