import { ensureDatabase } from "../../../../../../db/bootstrap";
import { requestOwner } from "../../../../../../lib/server";
import { requestEducationScope } from "../../../../../../lib/education-scope";
import { createPaperExportToken } from "../../../../../../lib/paper-export-token";
import { PdfExportBusyError, renderUrlToPdf } from "../../../../../../lib/pdf-export";
import { readAuthoringProject } from "../../../../../services/authoring";
import { readyAuthoringProject } from "../../../../../services/authoring-chapters";
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  await ensureDatabase();
  const owner = requestOwner(request), scope = requestEducationScope(request), id = (await context.params).projectId;
  if (!readAuthoringProject(owner, scope, id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  let project;
  try { project = readyAuthoringProject(owner, scope, id); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "作品尚不能导出" }, { status: 409 }); }
  const query = new URL(request.url), answers = query.searchParams.get("answers") === "1";
  try {
    const url = new URL(`/studio/${encodeURIComponent(id)}/print`, process.env.APP_BASE_URL || query.origin);
    url.searchParams.set("token", createPaperExportToken(`authoring:${id}`, owner, 300));
    if (answers) url.searchParams.set("answers", "1");
    const pdf = await renderUrlToPdf(url.toString(), 120000, { pageNumbers: true });
    const name = project.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-length": String(pdf.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename="teaching-material.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}-${answers ? "教师版" : "学生版"}.pdf`)}` } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "PDF 导出失败" }, { status: error instanceof PdfExportBusyError ? 429 : 500 }); }
}
