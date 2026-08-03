"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, ScanLine, UploadCloud } from "lucide-react";

type Stage = "idle" | "rendering" | "uploading" | "extracting" | "waiting_model" | "done" | "error";
type RenderedPage = { blob: Blob; width: number; height: number };
type RenderedDocument = { pages: RenderedPage[]; renderer: string };
type UploadTask = { id: string; fileName: string; stage: Stage; message: string; pageCount: number; completedPages: number; documentId?: string; renderer?: string };

async function canvasToPage(canvas: HTMLCanvasElement): Promise<RenderedPage> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("页面截图失败")), "image/jpeg", 0.9);
  });
  return { blob, width: canvas.width, height: canvas.height };
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

async function renderFile(file: File): Promise<RenderedDocument> {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return { pages: await renderPdf(file), renderer: "pdf.js" };
  throw new Error("当前产品仅支持 PDF 试卷，请先将其他格式另存为 PDF。");
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, operation: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export function UploadWorkbench() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [sourceMeta, setSourceMeta] = useState({ subject: "数学", grade: "九年级", sourceYear: String(new Date().getFullYear()), sourceExamType: "", sourceRegion: "", sourceSchool: "" });
  const working = tasks.some((task) => ["rendering", "uploading", "extracting"].includes(task.stage));

  function patchTask(taskId: string, patch: Partial<UploadTask>) {
    setTasks((items) => items.map((item) => item.id === taskId ? { ...item, ...patch } : item));
  }

  async function ensureModelReady() {
    const response = await fetch("/api/model-profiles", { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as {
      profiles?: Array<{ id: string; displayName: string; apiKeyMask: string | null }>;
      selectedProfileId?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(result.error ?? "无法读取模型配置");
    const selected = result.profiles?.find((profile) => profile.id === result.selectedProfileId);
    if (!selected?.apiKeyMask) throw new Error("识题模型尚未配置 API Key，请先到“模型设置”填写并测试连接。");
  }

  async function processFile(file: File, taskId: string, metadata: typeof sourceMeta) {
    patchTask(taskId, { stage: "rendering", message: "正在把原卷渲染为高清页面…" });
    let persistedDocumentId: string | undefined;
    try {
      const provisional = new FormData();
      provisional.append("file", file);
      provisional.append("pageCount", "0");
      Object.entries(metadata).forEach(([key, value]) => provisional.append(key, value));
      const provisionalResponse = await fetch("/api/documents", { method: "POST", body: provisional });
      const provisionalResult = await provisionalResponse.json() as { id?: string; error?: string; status?: string };
      if (!provisionalResponse.ok || !provisionalResult.id) throw new Error(provisionalResult.error ?? "原卷预登记失败");
      const currentDocumentId = provisionalResult.id;
      persistedDocumentId = currentDocumentId;
      patchTask(taskId, { documentId: currentDocumentId });
      router.refresh();
      if (provisionalResult.status === "complete") {
        patchTask(taskId, { stage: "done", message: "相同原卷已经处理完成，可直接进入题库或审核。" });
        return;
      }
      const rendered = await renderFile(file);
      const pages = rendered.pages;
      patchTask(taskId, { pageCount: pages.length, renderer: rendered.renderer, stage: "uploading", message: `已生成 ${pages.length} 页，正在并发保存页面证据…` });
      const original = new FormData();
      original.append("file", file);
      original.append("pageCount", String(pages.length));
      Object.entries(metadata).forEach(([key, value]) => original.append(key, value));
      const documentResponse = await fetch("/api/documents", { method: "POST", body: original });
      const documentResult = await documentResponse.json() as { id?: string; error?: string };
      if (!documentResponse.ok || !documentResult.id) throw new Error(documentResult.error ?? "原卷保存失败");
      if (documentResult.id !== currentDocumentId) throw new Error("原卷登记与分页任务不一致");
      router.refresh();
      let uploadedCount = 0;
      const pageIds = await mapWithConcurrency(pages, 3, async (page, index) => {
        const form = new FormData();
        form.append("page", page.blob, "page-" + (index + 1) + ".jpg");
        form.append("pageNumber", String(index + 1));
        form.append("width", String(page.width));
        form.append("height", String(page.height));
        const pageResponse = await fetch("/api/documents/" + currentDocumentId + "/pages", { method: "POST", body: form });
        const pageResult = await pageResponse.json() as { id?: string; error?: string };
        if (!pageResponse.ok || !pageResult.id) throw new Error(pageResult.error ?? `第 ${index + 1} 页保存失败`);
        uploadedCount += 1;
        patchTask(taskId, { completedPages: uploadedCount, message: `正在保存页面证据（${uploadedCount}/${pages.length}）…` });
        return pageResult.id;
      });
      try {
        await ensureModelReady();
      } catch (error) {
        patchTask(taskId, { stage: "waiting_model", message: (error instanceof Error ? error.message : "识题模型尚未配置") + " 原卷和分页图已经安全保存，可配置模型后在审核页重试识别。" });
        router.refresh();
        return;
      }
      patchTask(taskId, { stage: "extracting", completedPages: 0, message: `视觉模型正在并发识别 ${pages.length} 页，并检查跨页题…` });
      let extractedPages = 0;
      const extractionResults = await mapWithConcurrency(pages, 2, async (_page, index) => {
        const extractionResponse = await fetch("/api/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            documentId: currentDocumentId,
            pageId: pageIds[index],
            pageNumber: index + 1,
            fileName: file.name,
          }),
        });
        const result = await extractionResponse.json() as { questions?: unknown[]; error?: string };
        if (!extractionResponse.ok) throw new Error(result.error ?? "第 " + (index + 1) + " 页识题失败");
        extractedPages += 1;
        patchTask(taskId, { completedPages: extractedPages, message: `视觉模型识别中（${extractedPages}/${pages.length}），正在合并跨页题…` });
        return result.questions?.length ?? 0;
      });
      const extractedCount = extractionResults.reduce((sum, count) => sum + count, 0);
      const finalizeResponse = await fetch(`/api/documents/${currentDocumentId}/finalize`, { method: "POST" });
      const finalizeResult = await finalizeResponse.json().catch(() => ({})) as { error?: string };
      if (!finalizeResponse.ok) throw new Error(finalizeResult.error ?? "跨页题与答案合并失败");
      patchTask(taskId, { stage: "done", completedPages: pages.length, message: `识别完成：共发现 ${extractedCount} 道题，已进入待审核区。` });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "处理失败，请稍后再试";
      patchTask(taskId, { stage: "error", message });
      if (persistedDocumentId) {
        await fetch(`/api/documents/${persistedDocumentId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "failed", error: message }),
        }).catch(() => undefined);
      }
      router.refresh();
    }
  }

  async function processFiles(files: File[]) {
    if (!files.length) return;
    const metadata = { ...sourceMeta };
    const queued = files.map((file) => ({ id: crypto.randomUUID(), file }));
    setTasks((items) => [...queued.map((item) => ({
      id: item.id, fileName: item.file.name, stage: "idle" as Stage, message: "等待处理…", pageCount: 0, completedPages: 0,
    })), ...items]);
    await mapWithConcurrency(queued, 2, (item) => processFile(item.file, item.id, metadata));
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void processFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div className="upload-card card">
      <div className="section-title"><div><h2>批量上传试卷</h2><p>最多同时处理 2 份试卷，每份并发上传 3 页、识别 2 页</p></div><span className="pill dark"><ScanLine size={12} /> AI 自动抽题</span></div>
      <div className="upload-source-grid">
        <label><span>学科</span><input value={sourceMeta.subject} onChange={(event) => setSourceMeta({ ...sourceMeta, subject: event.target.value })} /></label>
        <label><span>年级</span><input value={sourceMeta.grade} onChange={(event) => setSourceMeta({ ...sourceMeta, grade: event.target.value })} /></label>
        <label><span>年份</span><input type="number" value={sourceMeta.sourceYear} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceYear: event.target.value })} /></label>
        <label><span>考试类型</span><input placeholder="如：二模 / 中考" value={sourceMeta.sourceExamType} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceExamType: event.target.value })} /></label>
        <label><span>地区</span><input placeholder="如：上海市" value={sourceMeta.sourceRegion} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceRegion: event.target.value })} /></label>
        <label><span>学校</span><input placeholder="可选" value={sourceMeta.sourceSchool} onChange={(event) => setSourceMeta({ ...sourceMeta, sourceSchool: event.target.value })} /></label>
      </div>
      <input ref={inputRef} hidden multiple type="file" accept=".pdf,application/pdf" onChange={(event) => { void processFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <div
        className={"drop-zone " + (working ? "working " : "")}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <span className="upload-orbit">
          {working ? <LoaderCircle size={28} className="spin" /> : <UploadCloud size={29} />}
        </span>
        <strong>拖入一批试卷，或点击多选文件</strong>
        <p>{working ? "后台队列正在继续处理；可以打开其他试卷，任务不会从列表消失。" : "仅支持 PDF，可一次选择多份试卷"}</p>
        <div className="file-types"><span><FileText size={13} /> PDF 试卷</span></div>
      </div>
      {tasks.length > 0 && <div className="upload-task-list">
        {tasks.map((task) => <article key={task.id} className={`upload-task ${task.stage}`}>
          <span className="upload-task-icon">{["rendering", "uploading", "extracting"].includes(task.stage) ? <LoaderCircle className="spin" size={16} /> : task.stage === "done" ? <CheckCircle2 size={16} /> : task.stage === "error" ? <AlertCircle size={16} /> : <FileText size={16} />}</span>
          <div><strong>{task.fileName}</strong><small>{task.message}</small>{task.renderer && <em>渲染：{task.renderer}</em>}</div>
          <b>{task.pageCount ? `${Math.min(task.completedPages, task.pageCount)}/${task.pageCount} 页` : task.stage === "idle" ? "排队中" : "准备中"}</b>
          {task.documentId && <Link href={`/review/${task.documentId}`} onClick={(event) => event.stopPropagation()}>{task.stage === "done" ? "审核" : "查看"}</Link>}
        </article>)}
      </div>}
      <div className="upload-meta"><span><b>{tasks.length || "—"}</b> 试卷任务</span><i /><span><b>2</b> 份并发</span><i /><span><b>LaTeX</b> 数学公式</span></div>
    </div>
  );
}
