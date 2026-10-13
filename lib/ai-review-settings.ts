import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";

// Callers of this synchronous read have already initialized the database.
export function automaticAiReviewEnabled(ownerId: string) {
  const row = getSqlite().prepare("SELECT automatic_ai_review_enabled AS enabled FROM app_settings WHERE owner_id = ?")
    .get(ownerId) as { enabled: number } | undefined;
  return row?.enabled === 1;
}

export async function setAutomaticAiReviewEnabled(ownerId: string, enabled: boolean) {
  await ensureDatabase();
  getSqlite().prepare(`INSERT INTO app_settings (owner_id, automatic_ai_review_enabled, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET automatic_ai_review_enabled = excluded.automatic_ai_review_enabled, updated_at = excluded.updated_at`)
    .run(ownerId, enabled ? 1 : 0, new Date().toISOString());
}
