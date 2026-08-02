"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileImage, FileText, LoaderCircle, ScanLine, UploadCloud } from "lucide-react";

type Stage = "idle" | "rendering" | "uploading" | "extracting" | "done" | "error";
type RenderedPage = { blob: Blob; dataUrl: string; width: number; height: number };

async function canvasToPage(canvas: HTMLCanvasElement): Promise<RenderedPage> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("页面截图失败")), "image/jpeg", 0.9);
  });
  return { blob, dataUrl: canvas.toDataURL("image/jpeg", 0.9), width: canvas.width, height: canvas.height };
}

async function renderPdf(file: File): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: RenderedPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.65 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 PDF 画布");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pages.push(await canvasToPage(canvas));
  }
  return pages;
}

async function renderDocx(file: File): Promise<RenderedPage[]> {
  const [{ renderAsync }, html2canvasModule] = await Promise.all([import("docx-preview"), import("html2canvas")]);
  const html2canvas = html2canvasModule.default;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-20000px;top:0;width:900px;background:white;z-index:-1;";
  document.body.appendChild(host);
  try {
    await renderAsync(await file.arrayBuffer(), host, undefined, {
      breakPages: true,
      ignoreWidth: false,
      ignoreHeight: false,
      useBase64URL: true,
    });
    const sections = Array.from(host.querySelectorAll<HTMLElement>("section.docx"));
    const targets = sections.length ? sections : [host];
    const pages: RenderedPage[] = [];
    for (const target of targets) {
      const canvas = await html2canvas(target, { backgroundColor: "#ffffff", scale: 1.45, useCORS: true });
      pages.push(await canvasToPage(canvas));
    }
    return pages;
  } finally {
    host.remove();
  }
}

async function renderImage(file: File): Promise<RenderedPage[]> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片读取失败"));
      element.src = url;
    });
    const scale = Math.min(1, 1800 / image.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return [await canvasToPage(canvas)];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderFile(file: File) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return renderPdf(file);
  if (name.endsWith(".docx")) return renderDocx(file);
  if (file.type.startsWith("image/")) return renderImage(file);
  if (name.endsWith(".doc")) throw new Error("旧版 .doc 暂不支持浏览器直接渲染，请先另存为 .docx 或 PDF。");
  throw new Error("暂不支持该格式，请上传 PDF、DOCX、PNG、JPG 或 WEBP。");
}

export function UploadWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("支持 PDF、DOCX、PNG、JPG、WEBP");
  const [fileName, setFileName] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [documentId, setDocumentId] = useState<string>();
  const [sourceMeta, setSourceMeta] = useState({ subject: "数学", grade: "九年级", sourceYear: String(new Date().getFullYear()), sourceExamType: "", sourceRegion: "", sourceSchool: "" });
  const working = ["rendering", "uploading", "extracting"].includes(stage);

  async function processFile(file: File) {
    setFileName(file.name);
    setStage("rendering");
    setMessage("正在把原卷渲染为高清页面…");
    try {
      const pages = await renderFile(file);
      setPageCount(pages.length);
      setStage("uploading");
      setMessage("已生成 " + pages.length + " 页，正在保存原卷与页面证据…");
      const original = new FormData();
      original.append("file", file);
      original.append("pageCount", String(pages.length));
      Object.entries(sourceMeta).forEach(([key, value]) => original.append(key, value));
      const documentResponse = await fetch("/api/documents", { method: "POST", body: original });
      const documentResult = await documentResponse.json() as { id?: string; error?: string };
      if (!documentResponse.ok || !documentResult.id) throw new Error(documentResult.error ?? "原卷保存失败");
      const currentDocumentId = documentResult.id;
      setDocumentId(currentDocumentId);
      const pageIds: string[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const form = new FormData();
        form.append("page", pages[index].blob, "page-" + (index + 1) + ".jpg");
        form.append("pageNumber", String(index + 1));
        form.append("width", String(pages[index].width));
        form.append("height", String(pages[index].height));
        const pageResponse = await fetch("/api/documents/" + currentDocumentId + "/pages", { method: "POST", body: form });
        const pageResult = await pageResponse.json() as { id?: string; error?: string };
        if (!pageResponse.ok || !pageResult.id) throw new Error(pageResult.error ?? `第 ${index + 1} 页保存失败`);
        pageIds.push(pageResult.id);
      }
      setStage("extracting");
      let extractedCount = 0;
      for (let index = 0; index < pages.length; index += 1) {
        setMessage("视觉模型正在识别第 " + (index + 1) + " / " + pages.length + " 页的题目、LaTeX 与答案…");
        const extractionResponse = await fetch("/api/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId: currentDocumentId,
            pageId: pageIds[index],
            pageNumber: index + 1,
            image: pages[index].dataUrl,
            fileName: file.name,
          }),
        });
        const result = await extractionResponse.json() as { questions?: unknown[]; error?: string };
        if (!extractionResponse.ok) throw new Error(result.error ?? "第 " + (index + 1) + " 页识题失败");
        extractedCount += result.questions?.length ?? 0;
      }
      setStage("done");
      setMessage("识别完成：共发现 " + extractedCount + " 道题，已进入待审核区。");
    } catch (error) {
      setStage("error");
      setMessage(error instanceof Error ? error.message : "处理失败，请稍后再试");
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void processFile(file);
  }

  return (
    <div className="upload-card card">
      <div className="section-title"><div><h2>上传一份新试卷</h2><p>文件只在你的题库空间内保存</p></div><span className="pill dark"><ScanLine size={12} /> AI 自动抽题</span></div>
      <div className="upload-source-grid">
        <label><span>学科</span><input value={sourceMeta.subject} onChange={(event) => setSourceMeta({ ...sourceMeta, subject: event.target.value })} /></label>
        <label><span>年级</span><input value={sourceMeta.grade} onChange={(event) => setSourceMeta({ ...sourceMeta, grade: event.target.value })} /></label>
        <label><span>年份</span><input type="number" value={sourceMeta.sourceYear} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceYear: event.target.value })} /></label>
        <label><span>考试类型</span><input placeholder="如：二模 / 中考" value={sourceMeta.sourceExamType} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceExamType: event.target.value })} /></label>
        <label><span>地区</span><input placeholder="如：上海市" value={sourceMeta.sourceRegion} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceRegion: event.target.value })} /></label>
        <label><span>学校</span><input placeholder="可选" value={sourceMeta.sourceSchool} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceSchool: event.target.value })} /></label>
      </div>
      <input ref={inputRef} hidden type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,application/pdf,image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void processFile(file); }} />
      <div
        className={"drop-zone " + (working ? "working " : "") + (stage === "done" ? "success " : "") + (stage === "error" ? "failed" : "")}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={() => !working && inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <span className="upload-orbit">
          {working ? <LoaderCircle size={28} className="spin" /> : stage === "done" ? <CheckCircle2 size={29} /> : stage === "error" ? <AlertCircle size={29} /> : <UploadCloud size={29} />}
        </span>
        <strong>{fileName || "拖入试卷，或点击选择文件"}</strong>
        <p>{message}</p>
        {stage === "done" ? (
          <Link href={"/review/" + documentId} className="btn btn-primary btn-small" onClick={(event) => event.stopPropagation()}>开始人工审核</Link>
        ) : (
          <div className="file-types"><span><FileText size={13} /> PDF / Word</span><span><FileImage size={13} /> 图片</span></div>
        )}
      </div>
      <div className="upload-meta"><span><b>{pageCount || "—"}</b> 页面</span><i /><span><b>{stage === "done" ? "JSON" : "—"}</b> 结构化结果</span><i /><span><b>LaTeX</b> 数学公式</span></div>
    </div>
  );
}
