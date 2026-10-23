import { randomUUID } from "node:crypto";
import { getSqlite } from "../../db";
import type { EducationScope } from "../../lib/education-scope";
import type { AuthoringChapterVersion } from "../../lib/authoring-content";

/** Call inside the transaction that replaces a chapter. JSON null also preserves plan-only revisions. */
export function archiveAuthoringChapter(chapterId: string, reason: string) {
  const db = getSqlite();
  const row = db.prepare("SELECT revision,plan_json,content_json FROM authoring_chapters WHERE id=?").get(chapterId) as { revision: number; plan_json: string; content_json: string | null } | undefined;
  if (!row) return;
  db.prepare("INSERT OR IGNORE INTO authoring_chapter_versions(id,chapter_id,revision,plan_json,content_json,reason,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(randomUUID(), chapterId, row.revision, row.plan_json, row.content_json ?? "null", reason, new Date().toISOString());
}

export function readAuthoringChapterVersion(owner: string, scope: EducationScope, projectId: string, chapterId: string, versionId: string) {
  const row = getSqlite().prepare(`SELECT v.id,v.revision,v.reason,v.created_at,v.plan_json,v.content_json FROM authoring_chapter_versions v JOIN authoring_chapters c ON c.id=v.chapter_id
    JOIN authoring_projects p ON p.id=c.project_id WHERE v.id=? AND c.id=? AND p.id=? AND p.owner_id=? AND p.subject=? AND p.stage=?`)
    .get(versionId, chapterId, projectId, owner, scope.subject, scope.stage) as { id: string; revision: number; reason: string; created_at: string; plan_json: string | null; content_json: string } | undefined;
  return row ? { id: row.id, revision: row.revision, reason: row.reason, createdAt: row.created_at,
    plan: row.plan_json ? JSON.parse(row.plan_json) : null, content: JSON.parse(row.content_json) } as AuthoringChapterVersion : null;
}
