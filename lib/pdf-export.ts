import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "../db";

declare global {
  var __SHITI_ACTIVE_PDF_EXPORTS__: number | undefined;
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

function runBrowser(executable: string, args: string[], timeoutMs: number) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PDF 生成超过 ${Math.round(timeoutMs / 1000)} 秒，已中止`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function readGeneratedPdf(outputPath: string, browserResult: { code: number | null; stderr: string }) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const bytes = await readFile(outputPath);
      if (bytes.byteLength >= 1000 && bytes.subarray(0, 4).toString("ascii") === "%PDF") return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`浏览器未生成有效 PDF（退出码 ${browserResult.code ?? "unknown"}）：${browserResult.stderr}`);
}

export async function renderUrlToPdf(url: string, timeoutMs = 60000) {
  globalThis.__SHITI_ACTIVE_PDF_EXPORTS__ ??= 0;
  if (globalThis.__SHITI_ACTIVE_PDF_EXPORTS__ >= 2) throw new PdfExportBusyError("PDF 生成任务较多，请稍后重试");
  globalThis.__SHITI_ACTIVE_PDF_EXPORTS__ += 1;
  const exportId = crypto.randomUUID();
  const exportRoot = path.resolve(dataDirectory(), "tmp", `pdf-${exportId}`);
  const allowedRoot = path.resolve(dataDirectory(), "tmp");
  if (!exportRoot.startsWith(allowedRoot + path.sep)) throw new Error("PDF 临时目录越界");
  const outputPath = path.join(exportRoot, "paper.pdf");
  const profilePath = path.join(exportRoot, "browser-profile");
  try {
    await mkdir(profilePath, { recursive: true });
    const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--disable-features=Vulkan,Dawn,UseSkiaRenderer",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profilePath}`,
    `--print-to-pdf=${outputPath}`,
    "--print-to-pdf-no-header",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=3000",
    ];
    if (process.platform === "win32" || process.env.CHROMIUM_NO_SANDBOX === "1") args.push("--no-sandbox");
    args.push(url);
    try {
      const browserResult = await runBrowser(chromiumExecutable(), args, timeoutMs);
      return await readGeneratedPdf(outputPath, browserResult);
    } finally {
      await rm(exportRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  } finally {
    globalThis.__SHITI_ACTIVE_PDF_EXPORTS__ = Math.max(0, (globalThis.__SHITI_ACTIVE_PDF_EXPORTS__ ?? 1) - 1);
  }
}
