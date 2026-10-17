import { requestEducationScope, documentScopeSql, type EducationScope } from "../../../../lib/education-scope";
import { getSqlite } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { MAX_QUESTION_FOLDER_DEPTH } from "../../../../lib/question-folder-rules";
import { now, requestOwner } from "../../../../lib/server";


function folderName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80 || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) {
    throw new Error("文件夹名称需为 1-80 个字符，且不能包含 \\ / : * ? \" < > |");
  }
  return name;
}

function ownedParent(ownerId: string, parentId: unknown, scope: EducationScope) {
  if (parentId === null || parentId === undefined || parentId === "") return null;
  if (typeof parentId !== "string" || parentId.length > 100) throw new Error("上级文件夹无效");
  const sqlite = getSqlite();
  let current: string | null = parentId;
  let depth = 0;
  while (current) {
    const row = sqlite.prepare(
      "SELECT parent_id AS parentId FROM question_folders WHERE id = ? AND owner_id = ? AND subject = ? AND stage = ?",
    ).get(current, ownerId, scope.subject, scope.stage) as { parentId: string | null } | undefined;
    if (!row) throw new Error("上级文件夹不存在");
    current = row.parentId;
    depth += 1;
    if (depth >= MAX_QUESTION_FOLDER_DEPTH) throw new Error(`题库文件夹最多支持 ${MAX_QUESTION_FOLDER_DEPTH} 层`);
  }
  return parentId;
}

export async function GET(request: Request) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const scope = requestEducationScope(request);
  const filter = documentScopeSql(scope);
  const folders = getSqlite().prepare(
    `SELECT f.id, f.parent_id AS parentId, f.name, f.created_at AS createdAt, f.updated_at AS updatedAt,
            COUNT(CASE WHEN d.id IS NOT NULL AND q.status = 'approved' THEN q.id END) AS questionCount
       FROM question_folders f LEFT JOIN questions q ON q.folder_id = f.id
       LEFT JOIN documents d ON d.id = q.document_id AND d.owner_id = f.owner_id${filter.sql}
      WHERE f.owner_id = ? AND f.subject = ? AND f.stage = ? GROUP BY f.id ORDER BY f.name COLLATE NOCASE`,
  ).all(...filter.params, ownerId, scope.subject, scope.stage);
  return Response.json({ folders });
}

export async function POST(request: Request) {
  await ensureDatabase();
  try {
    const payload = await request.json().catch(() => ({})) as { name?: unknown; parentId?: unknown };
    const ownerId = requestOwner(request);
    const name = folderName(payload.name);
    const scope = requestEducationScope(request);
    const parentId = ownedParent(ownerId, payload.parentId, scope);
    const duplicate = getSqlite().prepare(
      "SELECT id FROM question_folders WHERE owner_id = ? AND subject = ? AND stage = ? AND parent_id IS ? AND name = ? COLLATE NOCASE",
    ).get(ownerId, scope.subject, scope.stage, parentId, name);
    if (duplicate) return Response.json({ error: "同一位置已有同名文件夹" }, { status: 409 });
    const id = crypto.randomUUID();
    const timestamp = now();
    getSqlite().prepare(
      "INSERT INTO question_folders (id, owner_id, parent_id, name, created_at, updated_at, subject, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, ownerId, parentId, name, timestamp, timestamp, scope.subject, scope.stage);
    return Response.json({ folder: { id, parentId, name, questionCount: 0, createdAt: timestamp, updatedAt: timestamp } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建文件夹失败" }, { status: 400 });
  }
}
