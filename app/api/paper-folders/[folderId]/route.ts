import { deletePaperFolder, renamePaperFolder } from "../../../../lib/paper-library";
import { requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await context.params;
  const payload = await request.json().catch(() => ({})) as { name?: string };
  try {
    return Response.json(await renamePaperFolder(requestOwner(request), folderId, payload.name));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法重命名文件夹" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await context.params;
  try {
    return Response.json(await deletePaperFolder(requestOwner(request), folderId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法删除文件夹" }, { status: 400 });
  }
}
