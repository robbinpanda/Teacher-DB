import { deleteLibraryPaper, updateLibraryPaper } from "../../../../lib/paper-library";
import { requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await context.params;
  const payload = await request.json().catch(() => ({})) as { title?: string; folderId?: string | null };
  try {
    return Response.json(await updateLibraryPaper(requestOwner(request), paperId, payload));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法更新试卷" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await context.params;
  try {
    return Response.json(await deleteLibraryPaper(requestOwner(request), paperId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法删除试卷" }, { status: 400 });
  }
}
