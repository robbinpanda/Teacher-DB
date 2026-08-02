import { createPaperExportToken } from "../../../../../lib/paper-export-token";
import { PdfExportBusyError, renderUrlToPdf } from "../../../../../lib/pdf-export";
import { getPaperData } from "../../../../../lib/question-repository";
import { requestOwner } from "../../../../../lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80);
  return cleaned || "paper";
}

export async function GET(request: Request, context: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await context.params;
  const ownerId = requestOwner(request);
  const paper = await getPaperData(paperId, ownerId);
  if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const requestUrl = new URL(request.url);
  const configuredBase = process.env.APP_BASE_URL?.trim();
  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredBase || requestUrl.origin);
  } catch {
    return Response.json({ error: "APP_BASE_URL 配置无效" }, { status: 500 });
  }
  const token = createPaperExportToken(paperId, ownerId);
  const printUrl = new URL(`/papers/${encodeURIComponent(paperId)}/print`, baseUrl);
  printUrl.searchParams.set("token", token);
  if (requestUrl.searchParams.get("answers") === "1") printUrl.searchParams.set("answers", "1");
  try {
    const pdf = await renderUrlToPdf(printUrl.toString());
    const filename = `${safeFilename(paper.title)}${requestUrl.searchParams.get("answers") === "1" ? "-含答案" : ""}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(pdf.byteLength),
        "content-disposition": `attachment; filename="paper.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF 生成失败";
    return Response.json({ error: message }, { status: error instanceof PdfExportBusyError ? 429 : 500 });
  }
}
