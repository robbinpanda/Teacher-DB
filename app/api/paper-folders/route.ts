import { createPaperFolder, getPaperLibrary } from "../../../lib/paper-library";
import { requestOwner } from "../../../lib/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json(await getPaperLibrary(requestOwner(request)));
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { name?: string; parentId?: string | null };
  try {
    const folder = await createPaperFolder(requestOwner(request), payload.name, payload.parentId || null);
    return Response.json({ folder }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法创建文件夹" }, { status: 400 });
  }
}
