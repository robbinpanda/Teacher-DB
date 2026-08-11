"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, Gauge, LoaderCircle, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import { educationStages } from "../lib/education-taxonomy";
import { createDynamicConcurrencyController, DEFAULT_UPLOAD_CONCURRENCY, MAX_UPLOAD_CONCURRENCY } from "../lib/upload-concurrency";
import { useEducationScope } from "./AppShell";

type Stage = "idle" | "rendering" | "uploading" | "queued" | "extracting" | "retry_wait" | "paused" | "waiting_model" | "done" | "error";
type RenderedPage = { blob: Blob; width: number; height: number };
type UploadTask = { id: string; fileName: string; stage: Stage; message: string; pageCount: number; completedPages: number; documentId?: string; renderer?: string; modelDisplayName?: string };
type QueueSnapshot = {
  concurrency?: number;
  activeCount?: number;
  queuedCount?: number;
  paused?: boolean;
  pauseReason?: string | null;
  pausedCount?: number;
  jobs?: Array<{ documentId: string; status: string; totalPages: number; completedPages: number; nextAttemptAt?: string; lastError?: string; modelDisplayName?: string; modelName?: string }>;
  error?: string;
};
type WorkbenchModelProfile = {
  id: string;
  displayName: string;
  model: string;
  apiKeyMask: string | null;
};
type ModelProfilesResponse = {
  profiles?: WorkbenchModelProfile[];
  selectedProfileId?: string;
  error?: string;
};

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
  const { subject, stage } = useEducationScope();
  const inputRef = useRef<HTMLInputElement>(null);
  const concurrencyRef = useRef(DEFAULT_UPLOAD_CONCURRENCY);
  const concurrencyDraftDirtyRef = useRef(false);
  const batchControllerRef = useRef<{ setConcurrency: (value: unknown) => void } | null>(null);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [concurrencyDraft, setConcurrencyDraft] = useState(String(DEFAULT_UPLOAD_CONCURRENCY));
  const [appliedConcurrency, setAppliedConcurrency] = useState(DEFAULT_UPLOAD_CONCURRENCY);
  const [concurrencySaving, setConcurrencySaving] = useState(false);
  const [concurrencyFeedback, setConcurrencyFeedback] = useState("");
  const [concurrencyError, setConcurrencyError] = useState(false);
  const [queueCounts, setQueueCounts] = useState({ active: 0, queued: 0 });
  const [queuePaused, setQueuePaused] = useState(false);
  const [queuePauseReason, setQueuePauseReason] = useState("");
  const [batchActive, setBatchActive] = useState(false);
  const [modelProfiles, setModelProfiles] = useState<WorkbenchModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [modelLoading, setModelLoading] = useState(true);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelFeedback, setModelFeedback] = useState("");
  const [modelError, setModelError] = useState(false);
  const sourceMeta = { subject, grade: educationStages.find((item) => item.value === stage)?.defaultGrade ?? "九年级", sourceYear: "", sourceExamType: "", sourceRegion: "", sourceSchool: "" };
  const working = tasks.some((task) => ["rendering", "uploading", "queued", "extracting", "retry_wait"].includes(task.stage));
  const uploadDisabled = batchActive || modelLoading || modelSaving;

  function syncQueueSettings(result: QueueSnapshot, syncDraft = false) {
    if (typeof result.concurrency === "number") {
      concurrencyRef.current = result.concurrency;
      setAppliedConcurrency(result.concurrency);
      batchControllerRef.current?.setConcurrency(result.concurrency);
      if (syncDraft || !concurrencyDraftDirtyRef.current) setConcurrencyDraft(String(result.concurrency));
    }
    setQueueCounts({ active: Number(result.activeCount ?? 0), queued: Number(result.queuedCount ?? 0) });
    setQueuePaused(Boolean(result.paused));
    setQueuePauseReason(result.pauseReason ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/extraction-queue", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as QueueSnapshot }))
      .then(({ response, result }) => {
        if (cancelled || !response.ok) return;
        syncQueueSettings(result, true);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/model-profiles", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as ModelProfilesResponse }))
      .then(({ response, result }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(result.error ?? "无法读取模型配置");
        setModelProfiles(result.profiles ?? []);
        setSelectedProfileId(result.selectedProfileId ?? "");
        setModelError(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setModelError(true);
        setModelFeedback(error instanceof Error ? error.message : "无法读取模型配置");
      })
      .finally(() => { if (!cancelled) setModelLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tasks.some((task) => task.documentId && !["done", "error", "waiting_model"].includes(task.stage))) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch("/api/extraction-queue", { cache: "no-store" }).catch(() => undefined);
      if (!response?.ok || cancelled) return;
      const result = await response.json() as QueueSnapshot;
      syncQueueSettings(result);
      setTasks((items) => items.map((task) => {
        const job = result.jobs?.find((candidate) => candidate.documentId === task.documentId);
        if (!job || ["rendering", "uploading"].includes(task.stage)) return task;
        const modelDisplayName = job.modelDisplayName ?? job.modelName ?? task.modelDisplayName;
        if (job.status === "complete") return { ...task, modelDisplayName, stage: "done", completedPages: job.totalPages, message: "全部页面识别完成，已进入待审核区。" };
        if (job.status === "failed") return { ...task, modelDisplayName, stage: "error", message: job.lastError ?? "识别失败，可进入审核页重新入队。" };
        if (job.status === "retry_wait") return {
          ...task, modelDisplayName, stage: "retry_wait", completedPages: job.completedPages,
          message: `已保存 ${job.completedPages}/${job.totalPages} 页；网络退避中${job.nextAttemptAt ? `，${new Date(job.nextAttemptAt).toLocaleTimeString()} 自动继续` : ""}。`,
        };
        if (job.status === "paused") return {
          ...task, modelDisplayName, stage: "paused", completedPages: job.completedPages,
          message: `已保存 ${job.completedPages}/${job.totalPages} 页；全部识别已暂停，点击下方“全部开始”后继续。`,
        };
        return { ...task, modelDisplayName, stage: job.status === "processing" ? "extracting" : "queued", completedPages: job.completedPages, message: `可靠队列中：已完成 ${job.completedPages}/${job.totalPages} 页。` };
      }));
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tasks]);

  function patchTask(taskId: string, patch: Partial<UploadTask>) {
    setTasks((items) => items.map((item) => item.id === taskId ? { ...item, ...patch } : item));
  }

  async function applyConcurrency() {
    const concurrency = Number(concurrencyDraft);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_UPLOAD_CONCURRENCY) {
      setConcurrencyError(true);
      setConcurrencyFeedback(`请输入 1–${MAX_UPLOAD_CONCURRENCY} 的整数`);
      return;
    }
    setConcurrencySaving(true);
    setConcurrencyError(false);
    setConcurrencyFeedback("");
    try {
      const response = await fetch("/api/extraction-queue", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ concurrency }),
      });
      const result = await response.json().catch(() => ({})) as QueueSnapshot;
      if (!response.ok || typeof result.concurrency !== "number") throw new Error(result.error ?? "并发设置应用失败");
      concurrencyDraftDirtyRef.current = false;
      syncQueueSettings(result, true);
      setConcurrencyFeedback(`已应用 ${result.concurrency} 份并发，浏览器任务与后台队列已同步调整`);
    } catch (error) {
      setConcurrencyError(true);
      setConcurrencyFeedback(error instanceof Error ? error.message : "并发设置应用失败");
    } finally {
      setConcurrencySaving(false);
    }
  }

  async function selectModel(profileId: string) {
    const previousProfileId = selectedProfileId;
    const profile = modelProfiles.find((item) => item.id === profileId);
    setSelectedProfileId(profileId);
    setModelSaving(true);
    setModelError(false);
    setModelFeedback("");
    try {
      const response = await fetch("/api/model-profiles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectedProfileId: profileId }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "识别模型切换失败");
      setModelFeedback(`已选择 ${profile?.displayName ?? "识别模型"}，之后加入队列的试卷将使用它`);
    } catch (error) {
      setSelectedProfileId(previousProfileId);
      setModelError(true);
      setModelFeedback(error instanceof Error ? error.message : "识别模型切换失败");
    } finally {
      setModelSaving(false);
    }
  }

  async function ensureModelReady(profileId?: string) {
    const response = await fetch("/api/model-profiles", { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ModelProfilesResponse;
    if (!response.ok) throw new Error(result.error ?? "无法读取模型配置");
    const selected = result.profiles?.find((profile) => profile.id === (profileId ?? result.selectedProfileId));
    if (!selected?.apiKeyMask) throw new Error("识题模型尚未配置 API Key，请先到“模型设置”填写并测试连接。");
  }

  async function processFile(file: File, taskId: string, metadata: typeof sourceMeta, profileId?: string) {
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
        await ensureModelReady(profileId);
      } catch (error) {
        patchTask(taskId, { stage: "waiting_model", message: (error instanceof Error ? error.message : "识题模型尚未配置") + " 原卷和分页图已经安全保存，可配置模型后在审核页重试识别。" });
        router.refresh();
        return;
      }
      const queueResponse = await fetchWithBackoff(`/api/documents/${currentDocumentId}/queue`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retry: true, profileId }),
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
    if (!files.length || uploadDisabled) return;
    setBatchActive(true);
    const metadata = { ...sourceMeta };
    const batchProfileId = selectedProfileId || undefined;
    const batchProfile = modelProfiles.find((profile) => profile.id === batchProfileId);
    const queued = files.slice(0, 100).map((file) => ({ id: crypto.randomUUID(), file }));
    setTasks((items) => [...queued.map((item) => ({
      id: item.id, fileName: item.file.name, stage: "idle" as Stage, message: "等待处理…", pageCount: 0, completedPages: 0,
      modelDisplayName: batchProfile?.displayName,
    })), ...items]);
    const controller = createDynamicConcurrencyController(
      queued,
      concurrencyRef.current,
      (item) => processFile(item.file, item.id, metadata, batchProfileId),
    );
    batchControllerRef.current = controller;
    try {
      await controller.promise;
    } finally {
      if (batchControllerRef.current === controller) batchControllerRef.current = null;
      setBatchActive(false);
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void processFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div className="upload-card card">
      <div className="section-title upload-title"><div><span className="section-kicker">第一步 · 导入</span><h2>批量导入试卷</h2><p>选择 PDF，识别完成后进入审核列表</p></div><span className="save-note"><ShieldCheck size={14} /> 进度自动保存</span></div>
      <div className="upload-scope-note"><b>{educationStages.find((item) => item.value === stage)?.label} · {subject}</b><span>年份、考试类型、地区和学校会从卷面标题自动推测，可在试卷详情中随时修改。</span></div>
      <section className="upload-model-setting" aria-label="识别模型选择">
        <div className="upload-model-copy"><span><Sparkles size={16} /></span><div><strong>识别模型</strong><small>仅影响之后加入队列的试卷，处理中任务保持原模型</small></div></div>
        <div className="upload-model-controls">
          <select aria-label="选择识别模型" value={selectedProfileId} disabled={modelLoading || modelSaving || modelProfiles.length === 0} onChange={(event) => void selectModel(event.target.value)}>
            {modelProfiles.length === 0 && <option value="">{modelLoading ? "正在读取模型…" : "暂无可用模型"}</option>}
            {modelProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.displayName} · {profile.model}</option>)}
          </select>
          <Link className="btn" href="/settings/models">管理模型</Link>
        </div>
        <p className={modelError ? "error" : modelFeedback ? "success" : ""}>{modelFeedback || (modelLoading ? "正在同步模型配置…" : "在模型设置中添加、删除或修改配置")}</p>
      </section>
      <section className="upload-concurrency" aria-label="批量处理设置">
        <div className="upload-concurrency-copy"><span><Gauge size={16} /></span><div><strong>同时处理试卷</strong><small>同时控制 PDF 渲染、上传与后台识别；普通电脑建议 2–4 份</small></div></div>
        <div className="upload-concurrency-inputs">
          <label><input aria-label="同时处理试卷数" inputMode="numeric" type="number" min="1" max={MAX_UPLOAD_CONCURRENCY} value={concurrencyDraft} onChange={(event) => { concurrencyDraftDirtyRef.current = true; setConcurrencyDraft(event.target.value); setConcurrencyFeedback(""); }} onKeyDown={(event) => { if (event.key === "Enter") void applyConcurrency(); }} /><span>份</span></label>
          <button type="button" className="btn btn-primary" disabled={concurrencySaving} onClick={() => void applyConcurrency()}>{concurrencySaving ? "应用中…" : "应用"}</button>
        </div>
        <p className={concurrencyError ? "error" : concurrencyFeedback ? "success" : queuePaused ? "paused" : ""}>{concurrencyFeedback || (queuePaused ? (queuePauseReason || "全部识别已暂停，可在试卷列表中点击“全部开始”。") : `当前已应用 ${appliedConcurrency} 份并发 · 后台处理中 ${queueCounts.active} 份${queueCounts.queued ? ` · 等待 ${queueCounts.queued} 份` : ""}；处理中也可随时修改`)}</p>
      </section>
      <input ref={inputRef} hidden multiple type="file" accept=".pdf,application/pdf" onChange={(event) => { void processFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <div
        className={"drop-zone " + (working ? "working " : "")}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { if (uploadDisabled) event.preventDefault(); else onDrop(event); }}
        onClick={() => { if (!uploadDisabled) inputRef.current?.click(); }}
        onKeyDown={(event) => { if (!uploadDisabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); inputRef.current?.click(); } }}
        aria-disabled={uploadDisabled}
        role="button"
        tabIndex={0}
      >
        <span className="upload-symbol">
          {working ? <LoaderCircle size={23} className="spin" /> : <UploadCloud size={24} />}
        </span>
        <strong>{working ? "试卷正在处理" : "选择 PDF 试卷"}</strong>
        <p>{working ? "可以离开此页，后台会继续处理。" : "点击选择或将文件拖到这里，可一次导入多份"}</p>
        <span className="upload-reliability"><ShieldCheck size={13} /> 原卷、分页图和处理进度都会保留</span>
      </div>
      {tasks.length > 0 && <div className="upload-task-list">
        {tasks.map((task) => <article key={task.id} className={`upload-task ${task.stage}`}>
          <span className="upload-task-icon">{["rendering", "uploading", "queued", "extracting", "retry_wait"].includes(task.stage) ? <LoaderCircle className="spin" size={16} /> : task.stage === "done" ? <CheckCircle2 size={16} /> : task.stage === "error" ? <AlertCircle size={16} /> : <FileText size={16} />}</span>
          <div><strong>{task.fileName}</strong><small>{task.message}</small>{task.modelDisplayName && <em className="upload-task-model"><Sparkles size={10} /> 识别模型：{task.modelDisplayName}</em>}{task.renderer && <em>渲染：{task.renderer}</em>}</div>
          <b>{task.pageCount ? `${Math.min(task.completedPages, task.pageCount)}/${task.pageCount} 页` : task.stage === "idle" ? "排队中" : "准备中"}</b>
          {task.documentId && <Link href={`/review/${task.documentId}`} onClick={(event) => event.stopPropagation()}>{task.stage === "done" ? "审核" : "查看"}</Link>}
        </article>)}
      </div>}
    </div>
  );
}
