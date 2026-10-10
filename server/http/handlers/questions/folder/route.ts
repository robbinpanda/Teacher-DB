import { sqliteTransaction } from "../../../../../db";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { normalizeQuestionIds, QuestionBulkActionError } from "../../../../../lib/question-bulk-actions";
import { now, requestOwner } from "../../../../../lib/server";


export async function PATCH(request: Request) {
  await ensureDatabase();
  try {
    const payload = await request.json().catch(() => ({})) as { ids?: unknown; folderId?: unknown };
    const ids = normalizeQuestionIds(payload.ids);
    const folderId = payload.folderId === null || payload.folderId === "" ? null : String(payload.folderId ?? "");
    const ownerId = requestOwner(request);
    const changed = sqliteTransaction((sqlite) => {
      if (folderId) {
        const folder = sqlite.prepare("SELECT id FROM question_folders WHERE id = ? AND owner_id = ?").get(folderId, ownerId);
        if (!folder) throw Object.assign(new Error("目标文件夹不存在"), { status: 404 });
      }
      const placeholders = ids.map(() => "?").join(",");
      const owned = sqlite.prepare(
        `SELECT q.id FROM questions q JOIN documents d ON d.id = q.document_id
          WHERE d.owner_id = ? AND q.id IN (${placeholders})`,
      ).all(ownerId, ...ids) as Array<{ id: string }>;
      if (owned.length !== ids.length) throw Object.assign(new Error("部分题目不存在或不属于当前教师"), { status: 404 });
      return Number(sqlite.prepare(
        `UPDATE questions SET folder_id = ?, updated_at = ? WHERE id IN (${placeholders})`,
      ).run(folderId, now(), ...ids).changes);
    });
    return Response.json({ moved: changed, folderId });
  } catch (error) {
    const status = error instanceof QuestionBulkActionError
      ? error.status
      : typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : 400;
    return Response.json({ error: error instanceof Error ? error.message : "移动题目失败" }, { status });
  }
}
