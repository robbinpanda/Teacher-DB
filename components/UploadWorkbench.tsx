"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, ScanLine, UploadCloud } from "lucide-react";

type Stage = "idle" | "rendering" | "uploading" | "queued" | "extracting" | "retry_wait" | "waiting_model" | "done" | "error";
type RenderedPage = { blob: Blob; width: number; height: number };
type UploadTask = { id: string; fileName: string; stage: Stage; message: string; pageCount: number; completedPages: number; documentId?: string; renderer?: string };

async function canvasToPage(canvas: HTMLCanvasElement): Promise<RenderedPage> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("页面截图失败")), "image/jpeg", 0.9);
  });
  return { blob, width: canvas.width, height: canvas.height };
}

async function renderPdf(
  file: File,
  onReady: (pageCount: number) => Promise<void>,
  onPage: (page: RenderedPage, pageNumber: number, pageCount: number) => Promise<void>,
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  await onReady(pdf.numPages);
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.65 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 PDF 画布");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    await onPage(await canvasToPage(canvas), pageNumber, pdf.numPages);
    canvas.width = 1;
    canvas.height = 1;
  }
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

async function fetchWithBackoff(url: string, init: RequestInit, attempts = 5) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || ![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => window.setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** (attempt - 1))));
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(8000, 500 * 2 ** (attempt - 1))));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("网络请求失败");
}

export function UploadWorkbench() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [sourceMeta, setSourceMeta] = useState({ subject: "数学", grade: "九年级", sourceYear: String(new Date().getFullYear()), sourceExamType: "", sourceRegion: "", sourceSchool: "" });
  const working = tasks.some((task) => ["rendering", "uploading", "queued", "extracting", "retry_wait"].includes(task.stage));

  useEffect(() => {
    if (!tasks.some((task) => task.documentId && !["done", "error", "waiting_model"].includes(task.stage))) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch("/api/extraction-queue", { cache: "no-store" }).catch(() => undefined);
      if (!response?.ok || cancelled) return;
      const result = await response.json() as { jobs?: Array<{ documentId: string; status: string; totalPages: number; completedPages: number; nextAttemptAt?: string; lastError?: string }> };
      setTasks((items) => items.map((task) => {
        const job = result.jobs?.find((candidate) => candidate.documentId === task.documentId);
        if (!job || ["rendering", "uploading"].includes(task.stage)) return task;
        if (job.status === "complete") return { ...task, stage: "done", completedPages: job.totalPages, message: "全部页面识别完成，已进入待审核区。" };
        if (job.status === "failed") return { ...task, stage: "error", message: job.lastError ?? "识别失败，可进入审核页重新入队。" };
        if (job.status === "retry_wait") return {
          ...task, stage: "retry_wait", completedPages: job.completedPages,
          message: `已保存 ${job.completedPages}/${job.totalPages} 页；网络退避中${job.nextAttemptAt ? `，${new Date(job.nextAttemptAt).toLocaleTimeString()} 自动继续` : ""}。`,
        };
        return { ...task, stage: job.status === "processing" ? "extracting" : "queued", completedPages: job.completedPages, message: `可靠队列中：已完成 ${job.completedPages}/${job.totalPages} 页。` };
      }));
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tasks]);

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
      const provisionalResponse = await fetchWithBackoff("/api/documents", { method: "POST", body: provisional });
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
      const name = file.name.toLowerCase();
      if (file.type !== "application/pdf" && !name.endsWith(".pdf")) throw new Error("当前产品仅支持 PDF 试卷，请先将其他格式另存为 PDF。");
      await renderPdf(file, async (pageCount) => {
        patchTask(taskId, { pageCount, renderer: "pdf.js", stage: "uploading", message: `共 ${pageCount} 页，正在逐页渲染并安全保存…` });
        const original = new FormData();
        original.append("file", file);
        original.append("pageCount", String(pageCount));
        Object.entries(metadata).forEach(([key, value]) => original.append(key, value));
        const documentResponse = await fetchWithBackoff("/api/documents", { method: "POST", body: original });
        const documentResult = await documentResponse.json() as { id?: string; error?: string };
        if (!documentResponse.ok || !documentResult.id) throw new Error(documentResult.error ?? "原卷保存失败");
        if (documentResult.id !== currentDocumentId) throw new Error("原卷登记与分页任务不一致");
        router.refresh();
      }, async (page, pageNumber, pageCount) => {
        const form = new FormData();
        form.append("page", page.blob, "page-" + pageNumber + ".jpg");
        form.append("pageNumber", String(pageNumber));
        form.append("width", String(page.width));
        form.append("height", String(page.height));
        const pageResponse = await fetchWithBackoff("/api/documents/" + currentDocumentId + "/pages", { method: "POST", body: form });
        const pageResult = await pageResponse.json() as { id?: string; error?: string };
        if (!pageResponse.ok || !pageResult.id) throw new Error(pageResult.error ?? `第 ${pageNumber} 页保存失败`);
        patchTask(taskId, { completedPages: pageNumber, message: `页面证据已安全保存（${pageNumber}/${pageCount}）…` });
      });
      try {
        await ensureModelReady();
      } catch (error) {
        patchTask(taskId, { stage: "waiting_model", message: (error instanceof Error ? error.message : "识题模型尚未配置") + " 原卷和分页图已经安全保存，可配置模型后在审核页重试识别。" });
        router.refresh();
        return;
      }
      const queueResponse = await fetchWithBackoff(`/api/documents/${currentDocumentId}/queue`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retry: true }),
      });
      const queueResult = await queueResponse.json().catch(() => ({})) as { error?: string };
      if (!queueResponse.ok) throw new Error(queueResult.error ?? "加入识别队列失败");
      patchTask(taskId, { stage: "queued", completedPages: 0, message: "已加入可靠识别队列；关闭页面后服务端仍会继续。" });
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
    const queued = files.slice(0, 50).map((file) => ({ id: crypto.randomUUID(), file }));
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
        <p>{working ? "后台可靠队列正在继续；关闭当前页面也不会丢失已保存进度。" : "仅支持 PDF，一次最多选择 50 份"}</p>
        <div className="file-types"><span><FileText size={13} /> PDF 试卷</span></div>
      </div>
      {tasks.length > 0 && <div className="upload-task-list">
        {tasks.map((task) => <article key={task.id} className={`upload-task ${task.stage}`}>
          <span className="upload-task-icon">{["rendering", "uploading", "queued", "extracting", "retry_wait"].includes(task.stage) ? <LoaderCircle className="spin" size={16} /> : task.stage === "done" ? <CheckCircle2 size={16} /> : task.stage === "error" ? <AlertCircle size={16} /> : <FileText size={16} />}</span>
          <div><strong>{task.fileName}</strong><small>{task.message}</small>{task.renderer && <em>渲染：{task.renderer}</em>}</div>
          <b>{task.pageCount ? `${Math.min(task.completedPages, task.pageCount)}/${task.pageCount} 页` : task.stage === "idle" ? "排队中" : "准备中"}</b>
          {task.documentId && <Link href={`/review/${task.documentId}`} onClick={(event) => event.stopPropagation()}>{task.stage === "done" ? "审核" : "查看"}</Link>}
        </article>)}
      </div>}
      <div className="upload-meta"><span><b>{tasks.length || "—"}</b> 试卷任务</span><i /><span><b>50</b> 份/批</span><i /><span><b>2</b> 份识别并发</span></div>
    </div>
  );
}
