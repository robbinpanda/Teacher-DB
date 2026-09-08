import sharp from "sharp";
import type { SharedQuestionAsset } from "./question-package-format";

const formats = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function validateImportedImage(bytes: Uint8Array, mimeType: SharedQuestionAsset["mimeType"]) {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new Error("共享包包含无法解码或已损坏的图片");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== formats[mimeType]) throw new Error("共享包图片内容与声明格式不一致");
  if (!width || !height || width > 20_000 || height > 20_000 || width * height > 40_000_000) {
    throw new Error("共享包图片尺寸无效或超过 4000 万像素上限");
  }
  return { width, height, format: metadata.format };
}
