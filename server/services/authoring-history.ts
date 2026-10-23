import { randomUUID } from "node:crypto";
import { getSqlite } from "../../db";
import type { EducationScope } from "../../lib/education-scope";
import type { SavedChapterContent } from "../../lib/authoring-content";

/** Call inside the same transaction that replaces a chapter's content. */
export function archiveAuthoringChapter(chapterId: string, reason: string) {
  const db = getSqlite();
  const row = db.prepare("SELECT revision,content_json FROM authoring_chapters WHERE id=?").get(chapterId) as { revision: number; content_json: string | null } | undefined;
  if (!row?.content_json) return;
  db.prepare("INSERT OR IGNORE INTO authoring_chapter_versions(id,chapter_id,revision,content_json,reason,created_at) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(), chapterId, row.revision, row.content_json, reason, new Date().toISOString());
}

export function readAuthoringChapterVersion(owner: string, scope: EducationScope, projectId: string, chapterId: string, versionId: string) {
  const row = getSqlite().prepare(`SELECT v.content_json FROM authoring_chapter_versions v JOIN authoring_chapters c ON c.id=v.chapter_id
    JOIN authoring_projects p ON p.id=c.project_id WHERE v.id=? AND c.id=? AND p.id=? AND p.owner_id=? AND p.subject=? AND p.stage=?`)
    .get(versionId, chapterId, projectId, owner, scope.subject, scope.stage) as { content_json: string } | undefined;
  return row ? JSON.parse(row.content_json) as SavedChapterContent : null;
}
