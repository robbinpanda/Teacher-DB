import type { PDFDocumentLoadingTask } from "pdfjs-dist";

export const MAX_BROWSER_PDF_CONCURRENCY = 2;
export const PDF_RESOURCE_OPTIONS = {
  cMapUrl: "/api/pdf-assets/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/api/pdf-assets/standard_fonts/",
  wasmUrl: "/api/pdf-assets/wasm/",
};
export const MAX_PAGE_PIXELS = 8_000_000;
const MAX_PAGE_DIMENSION = 4096;
export type RenderedPage = { blob: Blob; width: number; height: number };

export function browserPdfConcurrency(value: number) {
  return Math.max(1, Math.min(MAX_BROWSER_PDF_CONCURRENCY, Math.floor(value) || 1));
}

export function boundedPdfScale(width: number, height: number) {
  if (!(width > 0 && height > 0 && Number.isFinite(width * height))) throw new Error("PDF 页面尺寸无效");
  return Math.min(1.65, Math.sqrt(MAX_PAGE_PIXELS / (width * height)), MAX_PAGE_DIMENSION / width, MAX_PAGE_DIMENSION / height);
}

/** Destroy the loading task even if parsing, rendering or uploading fails. */
export async function renderPdfPages(
  task: PDFDocumentLoadingTask,
  onReady: (pageCount: number) => Promise<void>,
  onPage: (page: RenderedPage, pageNumber: number, pageCount: number) => Promise<void>,
  createCanvas = () => document.createElement("canvas"),
) {
  try {
    const pdf = await task.promise;
    await onReady(pdf.numPages);
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      let canvas: HTMLCanvasElement | undefined;
      try {
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: boundedPdfScale(original.width, original.height) });
        canvas = createCanvas();
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建 PDF 画布");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const width = canvas.width, height = canvas.height;
        const blob = await new Promise<Blob>((resolve, reject) => canvas!.toBlob(
          value => value ? resolve(value) : reject(new Error("页面截图失败")), "image/jpeg", 0.9,
        ));
        // Release decoded pixels before waiting for a slow network upload.
        canvas.width = canvas.height = 0;
        await onPage({ blob, width, height }, number, pdf.numPages);
      } finally {
        if (canvas) canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
  } finally {
    await task.destroy();
  }
}
