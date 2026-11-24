import "server-only";

import { mkdtemp, rm, writeFile, copyFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { getFile, putFile } from "./file-storage";
import { chromiumExecutable } from "./pdf-export";
import { DOC_MIME, DOCX_MIME } from "./word-mime";
import { saveWordSummary } from "./word-report";
import { checkWordFormulas, wordParseSchema, wordToHtml, type WordParse } from "./word-text";

export { DOCX_MIME };
export { restoreWordFormulas, wordModelText, type WordParse } from "./word-text";

export class WordImportError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export function wordStorageKeys(documentId: string) {
  const base = `documents/${documentId}/word`;
  return { parsed: `${base}/parsed.json`, rendered: `${base}/rendered.pdf`, asset: (id: string, mime: string) => `${base}/assets/${id}.${mime === "image/jpeg" ? "jpg" : "png"}` };
}

function processorRequest(path: string, bytes: Uint8Array<ArrayBuffer>, mimeType: string, signal?: AbortSignal) {
  const endpoint = new URL(path, process.env.JIANTI_DOCUMENT_PROCESSOR_URL);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new WordImportError("文档处理服务地址必须是 HTTP(S)", false);
  const token = process.env.JIANTI_PROCESSOR_TOKEN ?? "";
  const timeout = AbortSignal.timeout(5 * 60 * 1000);
  return fetch(endpoint, { method: "POST", headers: { "content-type": mimeType === DOC_MIME ? DOC_MIME : DOCX_MIME, "x-processor-token": token },
    body: bytes, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
}

/** Ask the private processor to read the Word file (.doc is converted there first). */
export async function requestWordParse(bytes: Uint8Array<ArrayBuffer>, mimeType: string, signal?: AbortSignal): Promise<WordParse> {
  const response = await processorRequest("/v1/docx/parse", bytes, mimeType, signal);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new WordImportError(body.error ?? `文档处理服务返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429);
  const parsed = wordParseSchema.safeParse(body);
  if (!parsed.success) throw new WordImportError("文档处理服务返回的 Word 解析结果格式无效", false);
  return parsed.data;
}

/** Store images separately and keep the parse (without image bytes) for extraction. */
export async function storeWordParse(documentId: string, parse: WordParse) {
  const keys = wordStorageKeys(documentId);
  const assets = [];
  for (const asset of parse.assets) {
    const key = keys.asset(asset.id, asset.mime);
    if (asset.base64) await putFile(key, Buffer.from(asset.base64, "base64"));
    assets.push({ id: asset.id, role: asset.role, mime: asset.mime, width: asset.width, height: asset.height,
      displayWidth: asset.displayWidth ?? null, displayHeight: asset.displayHeight ?? null, key });
  }
  const stored: WordParse = { ...parse, assets };
  await putFile(keys.parsed, new TextEncoder().encode(JSON.stringify(stored)));
  await saveWordSummary(documentId, parse.report);
  return stored;
}

export async function loadWordParse(documentId: string): Promise<WordParse | null> {
  const bytes = await getFile(wordStorageKeys(documentId).parsed).catch(() => null);
  if (!bytes) return null;
  const parsed = wordParseSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  return parsed.success ? parsed.data : null;
}

/** Typeset the parsed paper and print it to PDF so the existing page pipeline can run. */
export async function renderWordPdf(parse: WordParse, timeoutMs = 120000) {
  const folder = await mkdtemp(path.join(tmpdir(), "jianti-word-"));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const katexDist = path.resolve("node_modules", "katex", "dist");
    await mkdir(path.join(folder, "katex", "fonts"), { recursive: true });
    await copyFile(path.join(katexDist, "katex.min.css"), path.join(folder, "katex", "katex.min.css"));
    for (const font of await readdir(path.join(katexDist, "fonts"))) {
      if (font.endsWith(".woff2")) await copyFile(path.join(katexDist, "fonts", font), path.join(folder, "katex", "fonts", font));
    }
    await mkdir(path.join(folder, "assets"));
    for (const asset of parse.assets) {
      if (!asset.key) continue;
      await writeFile(path.join(folder, "assets", asset.id), await getFile(asset.key));
    }
    const file = path.join(folder, "index.html");
    await writeFile(file, wordToHtml(parse), "utf8");
    browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, timeout: timeoutMs });
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.emulateMedia({ media: "print" });
    await page.goto(pathToFileURL(file).toString(), { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined)));
    });
    return await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser?.close().catch(() => undefined);
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Print the paper with its own layout (LibreOffice in the processor). */
export async function requestOriginalLayoutPdf(bytes: Uint8Array<ArrayBuffer>, mimeType: string, signal?: AbortSignal) {
  const response = await processorRequest("/v1/docx/render", bytes, mimeType, signal);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new WordImportError(body.error ?? `文档处理服务返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429);
  }
  const pdf = new Uint8Array(await response.arrayBuffer());
  if (new TextDecoder("latin1").decode(pdf.slice(0, 5)) !== "%PDF-") throw new WordImportError("Word 原版式排版结果无效", false);
  return pdf;
}

/** Read, check, store and typeset a Word paper; returns the PDF used as its source pages. */
export async function prepareWordDocument(documentId: string, docx: Uint8Array<ArrayBuffer>, mimeType: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const parse = await requestWordParse(docx, mimeType, signal);
  if (!parse.blocks.length) throw new WordImportError("Word 文件中没有读到正文内容", false);
  const renderErrors = checkWordFormulas(parse);
  if (renderErrors) parse.report.warnings.push(`${renderErrors} 个公式转换后无法排版，已改为按页面图片识别并标记待核对`);
  const stored = await storeWordParse(documentId, parse);
  signal?.throwIfAborted();
  let pdf: Uint8Array<ArrayBuffer>;
  // Pictures placed at page coordinates (PDF-to-Word papers) only land in the
  // right place in the paper's own layout; other papers are typeset from the parse.
  if (parse.report.layout === "positioned") pdf = await requestOriginalLayoutPdf(docx, mimeType, signal);
  else try { pdf = new Uint8Array(await renderWordPdf(stored)); }
  catch (error) { throw new WordImportError(`Word 排版为页面失败：${error instanceof Error ? error.message.slice(0, 300) : "未知错误"}`, true); }
  await putFile(wordStorageKeys(documentId).rendered, pdf);
  return pdf;
}
