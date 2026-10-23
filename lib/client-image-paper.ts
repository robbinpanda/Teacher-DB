import { imagePageBoxes, jpegPagesToPdf, MAX_IMAGE_PAGES, isPaperImage } from "./image-paper";

export type PreparedImagePage = { id: string; sourceName: string; blob: Blob; width: number; height: number };
export async function prepareImagePages(file: File, splitLongImages: boolean): Promise<PreparedImagePage[]> {
  if (!isPaperImage(file) || !file.size || file.size > 20 * 1024 * 1024) throw new Error(`${file.name}：请选择 20 MB 以内的 JPG、PNG 或 WebP 图片`);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error(`${file.name}：图片损坏或格式不受支持`); }
  const canvas = document.createElement("canvas");
  const analysis = document.createElement("canvas");
  try {
    if (bitmap.width * bitmap.height > 40_000_000 || Math.max(bitmap.width, bitmap.height) > 20000) throw new Error(`${file.name}：图片不能超过 4000 万像素或 20000 像素边长`);
    const scale = Math.min(1, 320 / bitmap.width);
    analysis.width = Math.max(1, Math.round(bitmap.width * scale));
    analysis.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = analysis.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, analysis.width, analysis.height);
    ctx.drawImage(bitmap, 0, 0, analysis.width, analysis.height);
    const boxes = splitLongImages ? imagePageBoxes(ctx.getImageData(0, 0, analysis.width, analysis.height).data, analysis.width, analysis.height)
      : [{ x: 0, y: 0, width: analysis.width, height: analysis.height }];
    if (boxes.length > MAX_IMAGE_PAGES) throw new Error(`一份试卷最多 ${MAX_IMAGE_PAGES} 页`);
    const pages: PreparedImagePage[] = [];
    for (const box of boxes) {
      const x = Math.floor(box.x / analysis.width * bitmap.width), y = Math.floor(box.y / analysis.height * bitmap.height);
      const width = Math.min(bitmap.width - x, Math.ceil(box.width / analysis.width * bitmap.width));
      const height = Math.min(bitmap.height - y, Math.ceil(box.height / analysis.height * bitmap.height));
      // Preserve source resolution within each page instead of shrinking the entire long image.
      const resize = Math.min(1, 2400 / width, Math.sqrt(8_000_000 / (width * height)));
      canvas.width = Math.max(1, Math.round(width * resize)); canvas.height = Math.max(1, Math.round(height * resize));
      const target = canvas.getContext("2d")!; target.fillStyle = "white"; target.fillRect(0, 0, canvas.width, canvas.height);
      target.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("无法生成页面图片")), "image/jpeg", .95));
      pages.push({ id: crypto.randomUUID(), sourceName: file.name, blob, width: canvas.width, height: canvas.height });
    }
    return pages;
  } finally { bitmap.close(); canvas.width = canvas.height = analysis.width = analysis.height = 0; }
}

export async function imagePaperFile(pages: PreparedImagePage[], title: string) {
  const encoded = [];
  for (const page of pages) encoded.push({ width: page.width, height: page.height, bytes: new Uint8Array(await page.blob.arrayBuffer()) });
  const bytes = jpegPagesToPdf(encoded);
  if (bytes.length > 100 * 1024 * 1024) throw new Error("合成试卷超过 100 MB，请减少图片数量后重试");
  const name = title.trim().replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 160) || "图片试卷";
  return new File([bytes as BlobPart], `${name}.pdf`, { type: "application/pdf" });
}
