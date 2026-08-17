import type Database from "better-sqlite3";

export type ReusableDocument = {
  id: string;
  originalKey: string | null;
  pageCount: number;
  status: string;
};

/** Soft-deleted sources must never capture a later upload of the same PDF. */
export function findReusableDocument(
  sqlite: Database.Database,
  ownerId: string,
  checksum: string,
): ReusableDocument | undefined {
  return sqlite.prepare(
    `SELECT id, original_key AS originalKey, page_count AS pageCount, status
       FROM documents
      WHERE owner_id = ? AND checksum = ? AND source_removed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
  ).get(ownerId, checksum) as ReusableDocument | undefined;
}
