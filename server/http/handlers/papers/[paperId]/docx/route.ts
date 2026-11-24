import sharp from "sharp";
import { getFile } from "../../../../../../lib/file-storage";
import { normalizePaperSettings } from "../../../../../../lib/paper-templates";
import { getPaperData } from "../../../../../../lib/question-repository";
import { requestOwner } from "../../../../../../lib/server";
import { buildPaperDocx, type WordImage } from "../../../../../../lib/word-export";

function safeFilename(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80);
  return cleaned || "paper";
}

/** Word embeds JPEG and PNG; anything else (WebP crops) is re-encoded as PNG. */
async function loadImage(key: string): Promise<WordImage | null> {
  try {
    const bytes = await getFile(key);
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) return null;
    if (metadata.format === "jpeg") return { data: bytes, type: "jpg", width: metadata.width, height: metadata.height };
    if (metadata.format === "png") return { data: bytes, type: "png", width: metadata.width, height: metadata.height };
    return { data: await sharp(bytes).png().toBuffer(), type: "png", width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

export async function GET(request: Request, context: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await context.params;
  const paper = await getPaperData(paperId, requestOwner(request));
  if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const includeAnswers = new URL(request.url).searchParams.get("answers") === "1";
  const settings = normalizePaperSettings(paper.settings, paper.questions);
  const images = new Map<string, WordImage>();
  for (const question of paper.questions) {
    for (const asset of question.assets) {
      if (!asset.cropKey || (asset.role === "answer" && !includeAnswers)) continue;
      const image = await loadImage(asset.cropKey);
      if (image) images.set(asset.id, image);
    }
  }
  try {
    const result = await buildPaperDocx({ title: paper.title, subtitle: paper.subtitle, questions: paper.questions, settings, includeAnswers, images });
    const filename = `${safeFilename(paper.title)}${includeAnswers ? "-解析答案" : ""}.docx`;
    return new Response(result.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-length": String(result.bytes.byteLength),
        "content-disposition": `attachment; filename="paper.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        // Question numbers the teacher should look at after opening the file.
        "x-jianti-unconverted-formulas": result.unconvertedFormulas.join(","),
        "x-jianti-missing-images": result.missingImages.join(","),
      },
    });
  } catch (error) {
    console.error("[api] word export failed", error);
    return Response.json({ error: "Word 文件生成失败，请稍后重试" }, { status: 500 });
  }
}
