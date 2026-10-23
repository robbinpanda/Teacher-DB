import "server-only";

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

declare global {
  var __JIANTI_ACTIVE_PDF_EXPORTS__: number | undefined;
}

export class PdfExportBusyError extends Error {}

const knownExecutables = process.platform === "win32"
  ? [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

export function chromiumExecutable() {
  const configured = process.env.CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) {
    if (!existsSync(configured)) throw new Error("CHROMIUM_EXECUTABLE_PATH 指向的文件不存在");
    return configured;
  }
  const detected = knownExecutables.find(existsSync);
  if (!detected) throw new Error("未找到 Chrome/Edge/Chromium。请安装浏览器或设置 CHROMIUM_EXECUTABLE_PATH");
  return detected;
}

export async function renderUrlToPdf(url: string, timeoutMs = 60000) {
  globalThis.__JIANTI_ACTIVE_PDF_EXPORTS__ ??= 0;
  if (globalThis.__JIANTI_ACTIVE_PDF_EXPORTS__ >= 2) throw new PdfExportBusyError("PDF 生成任务较多，请稍后重试");
  globalThis.__JIANTI_ACTIVE_PDF_EXPORTS__ += 1;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, timeout: timeoutMs });
    const exportBrowser = browser;
    const work = async () => {
      const page = await exportBrowser.newPage();
      page.setDefaultTimeout(timeoutMs);
      // Measure in print media from the start, with no UI or screen-only background.
      await page.emulateMedia({ media: "print" });
      const response = await page.goto(url, { waitUntil: "load" });
      if (!response?.ok()) throw new Error("打印页面加载失败，请重新导出");
      await page.locator('.printable-paper[data-pagination-ready="true"]').waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        const images = Array.from(document.querySelectorAll<HTMLImageElement>(".printable-paper img"));
        await Promise.all(images.map(image => image.decode()));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      return page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    };
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`PDF 生成超过 ${Math.round(timeoutMs / 1000)} 秒，已中止`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => undefined);
    globalThis.__JIANTI_ACTIVE_PDF_EXPORTS__ = Math.max(0, (globalThis.__JIANTI_ACTIVE_PDF_EXPORTS__ ?? 1) - 1);
  }
}
