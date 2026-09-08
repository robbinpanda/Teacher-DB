import { getSqlite, sqliteTransaction } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { assertQuestionFolderMoveDepth, MAX_QUESTION_FOLDER_DEPTH } from "../../../../lib/question-folder-rules";
import { now, requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

function validName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80 || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error("文件夹名称无效");
  return name;
}

export async function PATCH(request: Request, context: { params: Promise<{ folderId: string }> }) {
  await ensureDatabase();
  try {
    const { folderId } = await context.params;
    const ownerId = requestOwner(request);
    const sqlite = getSqlite();
    const folder = sqlite.prepare("SELECT id, parent_id AS parentId, name FROM question_folders WHERE id = ? AND owner_id = ?")
      .get(folderId, ownerId) as { id: string; parentId: string | null; name: string } | undefined;
    if (!folder) return Response.json({ error: "文件夹不存在" }, { status: 404 });
    const payload = await request.json().catch(() => ({})) as { name?: unknown; parentId?: unknown };
    const name = payload.name === undefined ? folder.name : validName(payload.name);
    const parentId = payload.parentId === undefined ? folder.parentId : payload.parentId === null || payload.parentId === "" ? null : String(payload.parentId);
    if (parentId === folderId) throw new Error("不能把文件夹移动到自身");
    let current = parentId;
    let depth = 0;
    while (current) {
      if (current === folderId) throw new Error("不能把文件夹移动到其子文件夹");
      const row = sqlite.prepare("SELECT parent_id AS parentId FROM question_folders WHERE id = ? AND owner_id = ?")
        .get(current, ownerId) as { parentId: string | null } | undefined;
      if (!row) throw new Error("上级文件夹不存在");
      current = row.parentId;
      depth += 1;
      if (depth >= MAX_QUESTION_FOLDER_DEPTH) throw new Error(`题库文件夹最多支持 ${MAX_QUESTION_FOLDER_DEPTH} 层`);
    }
    const subtree = sqlite.prepare(
      `WITH RECURSIVE tree(id, depth, path) AS (
         SELECT id, 1, ',' || id || ',' FROM question_folders WHERE id = ? AND owner_id = ?
         UNION ALL
         SELECT f.id, tree.depth + 1, tree.path || f.id || ','
           FROM question_folders f JOIN tree ON f.parent_id = tree.id
          WHERE f.owner_id = ? AND instr(tree.path, ',' || f.id || ',') = 0
       ) SELECT COALESCE(MAX(depth), 1) AS depth FROM tree`,
    ).get(folderId, ownerId, ownerId) as { depth: number };
    assertQuestionFolderMoveDepth(depth, Number(subtree.depth));
    const duplicate = sqlite.prepare(
      "SELECT id FROM question_folders WHERE owner_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND id <> ?",
    ).get(ownerId, parentId, name, folderId);
    if (duplicate) return Response.json({ error: "同一位置已有同名文件夹" }, { status: 409 });
    const timestamp = now();
    sqlite.prepare("UPDATE question_folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(name, parentId, timestamp, folderId, ownerId);
    return Response.json({ folder: { id: folderId, name, parentId, updatedAt: timestamp } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "更新文件夹失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ folderId: string }> }) {
  await ensureDatabase();
  const { folderId } = await context.params;
  const ownerId = requestOwner(request);
  try {
    sqliteTransaction((sqlite) => {
      const folder = sqlite.prepare("SELECT id FROM question_folders WHERE id = ? AND owner_id = ?").get(folderId, ownerId);
      if (!folder) throw Object.assign(new Error("文件夹不存在"), { status: 404 });
      const child = sqlite.prepare("SELECT 1 FROM question_folders WHERE parent_id = ? AND owner_id = ? LIMIT 1").get(folderId, ownerId);
      const question = sqlite.prepare(
        `SELECT 1 FROM questions q JOIN documents d ON d.id = q.document_id
          WHERE q.folder_id = ? AND d.owner_id = ? LIMIT 1`,
      ).get(folderId, ownerId);
      if (child || question) throw Object.assign(new Error("请先移走文件夹中的题目和子文件夹，再删除此文件夹"), { status: 409 });
      sqlite.prepare("DELETE FROM question_folders WHERE id = ? AND owner_id = ?").run(folderId, ownerId);
    });
    return Response.json({ deleted: true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    return Response.json({ error: error instanceof Error ? error.message : "删除文件夹失败" }, { status });
  }
}
