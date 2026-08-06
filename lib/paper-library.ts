import "server-only";

import { getSqlite } from "../db";
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

function ownedFolder(ownerId: string, folderId: string) {
  return getSqlite().prepare("SELECT id FROM paper_folders WHERE id = ? AND owner_id = ?").get(folderId, ownerId) as { id: string } | undefined;
}

export async function getPaperLibrary(ownerId: string) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const folders = sqlite.prepare(
    `SELECT id, parent_id AS parentId, name, created_at AS createdAt, updated_at AS updatedAt
       FROM paper_folders WHERE owner_id = ? ORDER BY name COLLATE NOCASE`,
  ).all(ownerId) as PaperFolderRecord[];
  const rows = sqlite.prepare(
    `SELECT p.id, p.folder_id AS folderId, p.title, COALESCE(p.subtitle, '') AS subtitle,
       p.settings_json AS settingsJson, p.created_at AS createdAt, p.updated_at AS updatedAt,
       COUNT(pi.question_id) AS questionCount
     FROM papers p LEFT JOIN paper_items pi ON pi.paper_id = p.id
     WHERE p.owner_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`,
  ).all(ownerId) as Array<Omit<PaperLibraryRecord, "subject" | "stage"> & { settingsJson: string }>;
  const papers = rows.map(({ settingsJson, ...paper }) => {
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(settingsJson) as Record<string, unknown>; } catch { /* use empty metadata */ }
    return { ...paper, subject: typeof settings.subject === "string" ? settings.subject : "未设置", stage: typeof settings.stage === "string" ? settings.stage : "middle" };
  });
  return { folders, papers };
}

export async function createPaperFolder(ownerId: string, nameValue: unknown, parentId: string | null) {
  await ensureDatabase();
  const name = cleanName(nameValue, "文件夹名称");
  if (parentId && !ownedFolder(ownerId, parentId)) throw new Error("上级文件夹不存在");
  const duplicate = getSqlite().prepare(
    "SELECT id FROM paper_folders WHERE owner_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE",
  ).get(ownerId, parentId, name);
  if (duplicate) throw new Error("当前目录已有同名文件夹");
  const id = crypto.randomUUID();
  const timestamp = now();
  getSqlite().prepare(
    "INSERT INTO paper_folders (id, owner_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, ownerId, parentId, name, timestamp, timestamp);
  return { id, parentId, name, createdAt: timestamp, updatedAt: timestamp } satisfies PaperFolderRecord;
}

export async function renamePaperFolder(ownerId: string, folderId: string, nameValue: unknown) {
  await ensureDatabase();
  const name = cleanName(nameValue, "文件夹名称");
  const folder = getSqlite().prepare("SELECT parent_id AS parentId FROM paper_folders WHERE id = ? AND owner_id = ?").get(folderId, ownerId) as { parentId: string | null } | undefined;
  if (!folder) throw new Error("文件夹不存在");
  const duplicate = getSqlite().prepare(
    "SELECT id FROM paper_folders WHERE owner_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND id <> ?",
  ).get(ownerId, folder.parentId, name, folderId);
  if (duplicate) throw new Error("当前目录已有同名文件夹");
  getSqlite().prepare("UPDATE paper_folders SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(name, now(), folderId, ownerId);
  return { renamed: true };
}

export async function deletePaperFolder(ownerId: string, folderId: string) {
  await ensureDatabase();
  const sqlite = getSqlite();
  if (!ownedFolder(ownerId, folderId)) throw new Error("文件夹不存在");
  const contents = sqlite.prepare(
    `SELECT (SELECT COUNT(*) FROM paper_folders WHERE parent_id = ? AND owner_id = ?) +
            (SELECT COUNT(*) FROM papers WHERE folder_id = ? AND owner_id = ?) AS count`,
  ).get(folderId, ownerId, folderId, ownerId) as { count: number };
  if (contents.count) throw new Error("文件夹不为空，请先移动或删除其中内容");
  sqlite.prepare("DELETE FROM paper_folders WHERE id = ? AND owner_id = ?").run(folderId, ownerId);
  return { deleted: true };
}

export async function updateLibraryPaper(ownerId: string, paperId: string, input: { title?: unknown; folderId?: unknown }) {
  await ensureDatabase();
  const sqlite = getSqlite();
  const paper = sqlite.prepare("SELECT id FROM papers WHERE id = ? AND owner_id = ?").get(paperId, ownerId);
  if (!paper) throw new Error("试卷不存在");
  if (input.title !== undefined) {
    const title = cleanName(input.title, "试卷名称");
    sqlite.prepare("UPDATE papers SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(title, now(), paperId, ownerId);
  }
  if (input.folderId !== undefined) {
    const folderId = typeof input.folderId === "string" && input.folderId ? input.folderId : null;
    if (folderId && !ownedFolder(ownerId, folderId)) throw new Error("目标文件夹不存在");
    sqlite.prepare("UPDATE papers SET folder_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?").run(folderId, now(), paperId, ownerId);
  }
  return { updated: true };
}

export async function deleteLibraryPaper(ownerId: string, paperId: string) {
  await ensureDatabase();
  const result = getSqlite().prepare("DELETE FROM papers WHERE id = ? AND owner_id = ?").run(paperId, ownerId);
  if (!result.changes) throw new Error("试卷不存在");
  return { deleted: true };
}
