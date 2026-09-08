import sharp from "sharp";

export const pageImageFormats = {
  "image/jpeg": { format: "jpeg", extension: ".jpg" },
  "image/png": { format: "png", extension: ".png" },
  "image/webp": { format: "webp", extension: ".webp" },
} as const;

export type PageImageMime = keyof typeof pageImageFormats;

export function isPageImageMime(value: string): value is PageImageMime {
  return value in pageImageFormats;
}

export async function validatePageImage(bytes: Uint8Array, mimeType: PageImageMime, declaredWidth: number, declaredHeight: number) {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new Error("页面图片无法解码、已经损坏或像素数量过大");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (metadata.format !== pageImageFormats[mimeType].format) {
    throw new Error("页面图片内容与声明格式不一致");
  }
  if (!width || !height || width > 20_000 || height > 20_000 || width * height > 40_000_000) {
    throw new Error("页面图片尺寸无效或超过 4000 万像素上限");
  }
  if (width !== declaredWidth || height !== declaredHeight) {
    throw new Error(`页面图片实际尺寸 ${width}×${height} 与声明尺寸 ${declaredWidth}×${declaredHeight} 不一致`);
  }
  return { width, height, extension: pageImageFormats[mimeType].extension };
}
