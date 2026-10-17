import { documentScopeSql, defaultEducationScope, type EducationScope } from "./education-scope";
import "server-only";

import { getSqlite, sqliteTransaction } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { now } from "./server";

export type PaperFolderRecord = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PaperLibraryRecord = {
  id: string;
  kind: "uploaded" | "assembled";
  grade: string;
  status: string;
  originalUrl: string | null;
  sourceRemoved: boolean;
  approvedCount: number;
  folderId: string | null;
  title: string;
  subtitle: string;
  subject: string;
  stage: string;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
};

function cleanName(value: unknown, label: string) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 60 || /[\\/:*?"<>|]/.test(name)) throw new Error(`${label}需为 1–60 个字符，且不能包含 \\ / : * ? \" < > |`);
  return name;
}

export async function getPaperLibrary(ownerId: string, scope?: EducationScope) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const filter = documentScopeSql(scope);
  const folders = sqlite.prepare(
    `SELECT id, parent_id AS parentId, name, created_at AS createdAt, updated_at AS updatedAt
       FROM paper_folders WHERE owner_id = ?${scope ? ' AND subject = ? AND stage = ?' : ''} ORDER BY name COLLATE NOCASE`,
  ).all(ownerId, ...filter.params) as PaperFolderRecord[];
  const rows = sqlite.prepare(
    `SELECT p.id, p.folder_id AS folderId, p.title, COALESCE(p.subtitle, '') AS subtitle,
       p.settings_json AS settingsJson, p.created_at AS createdAt, p.updated_at AS updatedAt,
       COUNT(pi.question_id) AS questionCount
     FROM papers p LEFT JOIN paper_items pi ON pi.paper_id = p.id
     WHERE p.owner_id = ?${scope ? " AND json_extract(p.settings_json, '$.subject') = ? AND json_extract(p.settings_json, '$.stage') = ?" : ''} GROUP BY p.id ORDER BY p.updated_at DESC`,
  ).all(ownerId, ...filter.params) as Array<Pick<PaperLibraryRecord, "id" | "folderId" | "title" | "subtitle" | "createdAt" | "updatedAt" | "questionCount"> & { settingsJson: string }>;
  const papers: PaperLibraryRecord[] = rows.map(({ settingsJson, ...paper }) => {
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(settingsJson) as Record<string, unknown>; } catch { /* use empty metadata */ }
    return { ...paper, kind: "assembled", grade: "", status: "saved", originalUrl: null, sourceRemoved: false, approvedCount: paper.questionCount, subject: typeof settings.subject === "string" ? settings.subject : "", stage: typeof settings.stage === "string" ? settings.stage : "" };
  });
  const originals = sqlite.prepare(`
    SELECT d.id, d.paper_folder_id AS folderId, d.name AS title, '' AS subtitle,
      COALESCE(d.subject, '') AS subject, COALESCE(d.grade, '') AS grade, '' AS stage,
      d.status, d.original_key AS originalKey, d.source_removed_at AS sourceRemovedAt,
      d.created_at AS createdAt, d.updated_at AS updatedAt, COUNT(q.id) AS questionCount,
      COALESCE(SUM(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END), 0) AS approvedCount
    FROM documents d LEFT JOIN questions q ON q.document_id = d.id
    WHERE d.owner_id = ?${filter.sql} AND d.source_kind = 'uploaded'
    GROUP BY d.id
  `).all(ownerId, ...filter.params) as Array<Omit<PaperLibraryRecord, "kind" | "originalUrl" | "sourceRemoved"> & { originalKey: string | null; sourceRemovedAt: string | null }>;
  for (const { originalKey, sourceRemovedAt, ...document } of originals) papers.push({
    ...document, kind: "uploaded", sourceRemoved: Boolean(sourceRemovedAt),
    originalUrl: originalKey && !sourceRemovedAt ? `/api/files/${originalKey.split('/').map(encodeURIComponent).join('/')}` : null,
  });
  papers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { folders, papers };
}

export async function createPaperFolder(ownerId: string, nameValue: unknown, parentId: string | null, scope: EducationScope = defaultEducationScope) {
  await ensureDatabase();
  const name = cleanName(nameValue, "文件夹名称");
  const id = crypto.randomUUID();
  const timestamp = now();
  sqliteTransaction((transaction) => {
    if (parentId && !transaction.prepare("SELECT 1 FROM paper_folders WHERE id = ? AND owner_id = ? AND subject = ? AND stage = ?").get(parentId, ownerId, scope.subject, scope.stage)) {
      throw new Error("上级文件夹不存在");
    }
    const duplicate = transaction.prepare(
      "SELECT id FROM paper_folders WHERE owner_id = ? AND subject = ? AND stage = ? AND parent_id IS ? AND name = ? COLLATE NOCASE",
    ).get(ownerId, scope.subject, scope.stage, parentId, name);
    if (duplicate) throw new Error("当前目录已有同名文件夹");
    transaction.prepare(
      "INSERT INTO paper_folders (id, owner_id, parent_id, name, created_at, updated_at, subject, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, ownerId, parentId, name, timestamp, timestamp, scope.subject, scope.stage);
  });
  return { id, parentId, name, createdAt: timestamp, updatedAt: timestamp } satisfies PaperFolderRecord;
}

export async function renamePaperFolder(ownerId: string, folderId: string, nameValue: unknown) {
  await ensureDatabase();
  const name = cleanName(nameValue, "文件夹名称");
  sqliteTransaction((transaction) => {
    const folder = transaction.prepare("SELECT parent_id AS parentId, subject, stage FROM paper_folders WHERE id = ? AND owner_id = ?").get(folderId, ownerId) as { parentId: string | null; subject: string; stage: string } | undefined;
    if (!folder) throw new Error("文件夹不存在");
    const duplicate = transaction.prepare(
      "SELECT id FROM paper_folders WHERE owner_id = ? AND subject = ? AND stage = ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND id <> ?",
    ).get(ownerId, folder.subject, folder.stage, folder.parentId, name, folderId);
    if (duplicate) throw new Error("当前目录已有同名文件夹");
    transaction.prepare("UPDATE paper_folders SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(name, now(), folderId, ownerId);
  });
  return { renamed: true };
}

export async function deletePaperFolder(ownerId: string, folderId: string) {
  await ensureDatabase();
  sqliteTransaction((transaction) => {
    if (!transaction.prepare("SELECT 1 FROM paper_folders WHERE id = ? AND owner_id = ?").get(folderId, ownerId)) {
      throw new Error("文件夹不存在");
    }
    const contents = transaction.prepare(
      `SELECT (SELECT COUNT(*) FROM paper_folders WHERE parent_id = ? AND owner_id = ?) +
              (SELECT COUNT(*) FROM papers WHERE folder_id = ? AND owner_id = ?) +
              (SELECT COUNT(*) FROM documents WHERE paper_folder_id = ? AND owner_id = ?) AS count`,
    ).get(folderId, ownerId, folderId, ownerId, folderId, ownerId) as { count: number };
    if (contents.count) throw new Error("文件夹不为空，请先移动或删除其中内容");
    transaction.prepare("DELETE FROM paper_folders WHERE id = ? AND owner_id = ?").run(folderId, ownerId);
  });
  return { deleted: true };
}

export async function updateLibraryPaper(ownerId: string, paperId: string, input: { title?: unknown; folderId?: unknown }) {
  await ensureDatabase();
  const title = input.title !== undefined ? cleanName(input.title, "试卷名称") : undefined;
  const folderId = input.folderId !== undefined
    ? typeof input.folderId === "string" && input.folderId ? input.folderId : null
    : undefined;
  sqliteTransaction((transaction) => {
    const paper = transaction.prepare("SELECT id, settings_json AS settingsJson FROM papers WHERE id = ? AND owner_id = ?").get(paperId, ownerId) as { id: string; settingsJson: string } | undefined;
    if (!paper) throw new Error("试卷不存在");
    const settings = JSON.parse(paper.settingsJson) as EducationScope;
    if (folderId && !transaction.prepare("SELECT 1 FROM paper_folders WHERE id = ? AND owner_id = ? AND subject = ? AND stage = ?").get(folderId, ownerId, settings.subject, settings.stage)) {
      throw new Error("目标文件夹不存在");
    }
    const timestamp = now();
    if (title !== undefined) transaction.prepare("UPDATE papers SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(title, timestamp, paperId, ownerId);
    if (folderId !== undefined) transaction.prepare("UPDATE papers SET folder_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(folderId, timestamp, paperId, ownerId);
  });
  return { updated: true };
}

export async function deleteLibraryPaper(ownerId: string, paperId: string) {
  await ensureDatabase();
  const result = getSqlite().prepare("DELETE FROM papers WHERE id = ? AND owner_id = ?").run(paperId, ownerId);
  if (!result.changes) throw new Error("试卷不存在");
  return { deleted: true };
}
