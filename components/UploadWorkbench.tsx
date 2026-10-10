"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Plus, UploadCloud, X } from "lucide-react";
import { educationStages, gradesByStage, subjects, type EducationStage } from "../lib/education-taxonomy";
import { createDynamicConcurrencyController, DEFAULT_UPLOAD_CONCURRENCY, MAX_UPLOAD_CONCURRENCY } from "../lib/upload-concurrency";
import { useEducationScope } from "./AppShell";
import { fetchUploadJson } from "../lib/upload-request";
import { uploadResponseSchema } from "../lib/api-contracts";
import { WorkbenchDialog } from "./WorkbenchDialog";

type Stage = "idle" | "rendering" | "preparing" | "uploading" | "queued" | "extracting" | "retry_wait" | "paused" | "waiting_model" | "done" | "error";
type RenderedPage = { blob: Blob; width: number; height: number };
type UploadTask = { id: string; fileName: string; stage: Stage; message: string; pageCount: number; completedPages: number; questionTotal?: number | null; completedQuestionCount?: number; documentId?: string; renderer?: string; modelDisplayName?: string };
type QueueSnapshot = {
  preparations?: Array<{ documentId: string; status: string; completedPages: number; pageCount: number; lastError?: string }>;
  concurrency?: number;
  activeCount?: number;
  queuedCount?: number;
  paused?: boolean;
  pauseReason?: string | null;
  pausedCount?: number;
  jobs?: Array<{ documentId: string; status: string; totalPages: number; completedPages: number; questionTotal?: number | null; completedQuestionCount?: number; streamPhase?: string; streamMessage?: string; nextAttemptAt?: string; lastError?: string; modelDisplayName?: string; modelName?: string }>;
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

export function UploadWorkbench() {
  const router = useRouter();
  const { subject, stage, setSubject, setStage } = useEducationScope();
  const [open, setOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [taskSyncError, setTaskSyncError] = useState("");
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
  const [teachingProfile, setTeachingProfile] = useState({ region: "全国", textbook: "", grades: [] as string[] });
  const [uploadGrade, setUploadGrade] = useState("");
  const profileGrade = teachingProfile.grades.find((grade) => gradesByStage[stage].includes(grade));
  const effectiveGrade = gradesByStage[stage].includes(uploadGrade) ? uploadGrade : profileGrade ?? educationStages.find((item) => item.value === stage)?.defaultGrade ?? "九年级";
  const sourceMeta = {
    subject,
    grade: effectiveGrade,
    sourceYear: "",
    sourceExamType: "",
    sourceRegion: teachingProfile.region === "全国" ? "" : teachingProfile.region,
    sourceTextbook: teachingProfile.textbook,
    sourceSchool: "",
  };
  const working = tasks.some((task) => ["rendering", "preparing", "uploading", "queued", "extracting", "retry_wait"].includes(task.stage));
  const hasPendingTasks = tasks.some(task => task.documentId && !["done", "error", "waiting_model"].includes(task.stage));
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
    void fetch("/api/teacher-profile", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result: { profile?: { region?: string; textbook?: string; grades?: string[] } } | null) => {
        if (cancelled || !result?.profile) return;
        setTeachingProfile({
          region: result.profile.region ?? "全国",
          textbook: result.profile.textbook ?? "",
          grades: Array.isArray(result.profile.grades) ? result.profile.grades : [],
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (!hasPendingTasks) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch("/api/extraction-queue", { cache: "no-store" }).catch(() => undefined);
      if (cancelled) return;
      if (!response?.ok) throw new Error("无法同步导入进度");
      const result = await response.json().catch(() => null) as QueueSnapshot | null;
      if (!result || cancelled) return;
      syncQueueSettings(result);
      setTasks((items) => items.map((task) => {
        const job = result.jobs?.find((candidate) => candidate.documentId === task.documentId);
        const preparation = result.preparations?.find(candidate => candidate.documentId === task.documentId);
        if (task.stage === "preparing" && preparation && !job) {
          if (preparation.status === "failed") return { ...task, stage: "error", message: preparation.lastError ?? "后台分页失败，请在审核页重试。" };
          if (preparation.status === "complete") return { ...task, stage: "waiting_model", completedPages: preparation.completedPages, pageCount: preparation.pageCount, message: "原卷分页已保存，请配置识题模型后在审核页开始识别。" };
          return { ...task, completedPages: preparation.completedPages, pageCount: preparation.pageCount, message: `后台正在准备页面（${preparation.completedPages}/${preparation.pageCount || "待确认"}），关闭页面后仍会继续。` };
        }
        if (!job || ["rendering", "uploading"].includes(task.stage)) return task;
        const modelDisplayName = job.modelDisplayName ?? job.modelName ?? task.modelDisplayName;
        const questionTotal = job.questionTotal ?? null;
        const completedQuestionCount = job.completedQuestionCount ?? 0;
        const questionProgress = questionTotal ? `${completedQuestionCount}/${questionTotal} 题` : "正在统计题目总数";
        if (job.status === "complete") return { ...task, modelDisplayName, stage: "done", completedPages: job.totalPages, questionTotal, completedQuestionCount, message: `整卷 ${questionProgress} 已完成，已进入待审核区。` };
        if (job.status === "failed") return { ...task, modelDisplayName, stage: "error", message: job.lastError ?? "识别失败，可进入审核页重新入队。" };
        if (job.status === "retry_wait") return {
          ...task, modelDisplayName, stage: "retry_wait", completedPages: job.completedPages, questionTotal, completedQuestionCount,
          message: `已保存 ${questionProgress}；退避中${job.nextAttemptAt ? `，${new Date(job.nextAttemptAt).toLocaleTimeString()} 自动继续` : ""}。`,
        };
        if (job.status === "paused") return {
          ...task, modelDisplayName, stage: "paused", completedPages: job.completedPages, questionTotal, completedQuestionCount,
          message: `已保存 ${questionProgress}；识别已暂停，可在工作台“待处理”中点击“全部开始”继续。`,
        };
        return { ...task, modelDisplayName, stage: job.status === "processing" ? "extracting" : "queued", completedPages: job.completedPages, questionTotal, completedQuestionCount, message: job.streamMessage ?? `可靠队列中：${questionProgress}。` };
      }));
    };
    let timer: number;
    const next = async () => {
      try { await poll(); setTaskSyncError(""); } catch { setTaskSyncError("暂时无法同步导入进度，正在自动重试。"); } finally { if (!cancelled) timer = window.setTimeout(next, 3000); }
    };
    void next();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [hasPendingTasks]);

  function patchTask(taskId: string, patch: Partial<UploadTask>) {
    setTasks((items) => items.map((item) => item.id === taskId ? { ...item, ...patch } : item));
  }

  async function applyConcurrency() {
    const concurrency = Number(concurrencyDraft);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_UPLOAD_CONCURRENCY) {
      setConcurrencyError(true);
      setConcurrencyFeedback(`请输入 1–${MAX_UPLOAD_CONCURRENCY} 的整数`);
      return false;
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
      setConcurrencyFeedback(`已应用：同时处理 ${result.concurrency} 份试卷`);
      return true;
    } catch (error) {
      setConcurrencyError(true);
      setConcurrencyFeedback(error instanceof Error ? error.message : "并发设置应用失败");
      return false;
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
    if (!selected?.apiKeyMask) throw new Error("识题模型尚未配置 API Key，请先到“模型配置”填写并测试连接。");
  }

  async function processFile(file: File, taskId: string, metadata: typeof sourceMeta, profileId?: string) {
    patchTask(taskId, { stage: "rendering", message: "正在把原卷渲染为高清页面…" });
    let persistedDocumentId: string | undefined;
    try {
      const provisional = new FormData();
      provisional.append("file", file);
      provisional.append("pageCount", "0");
      if (profileId) provisional.append("profileId", profileId);
      Object.entries(metadata).forEach(([key, value]) => provisional.append(key, value));
      const provisionalResult = uploadResponseSchema.parse(await fetchUploadJson("/api/documents", { method: "POST", body: provisional }));
      if (!provisionalResult.id) throw new Error("原卷预登记失败");
      const currentDocumentId = provisionalResult.id;
      persistedDocumentId = currentDocumentId;
      patchTask(taskId, { documentId: currentDocumentId });
      router.refresh();
      if (provisionalResult.status === "complete") {
        patchTask(taskId, { stage: "done", message: "相同原卷已经处理完成，可直接进入题库或审核。" });
        return;
      }
      if (provisionalResult.preparationQueued) {
        patchTask(taskId, { stage: "preparing", renderer: "后台 PDF", message: "原卷已安全保存，后台正在准备页面；关闭网页后仍会继续。" });
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
        const documentResult = await fetchUploadJson<{ id?: string }>("/api/documents", { method: "POST", body: original });
        if (!documentResult.id) throw new Error("原卷保存失败");
        if (documentResult.id !== currentDocumentId) throw new Error("原卷登记与分页任务不一致");
        router.refresh();
      }, async (page, pageNumber, pageCount) => {
        const form = new FormData();
        form.append("page", page.blob, "page-" + pageNumber + ".jpg");
        form.append("pageNumber", String(pageNumber));
        form.append("width", String(page.width));
        form.append("height", String(page.height));
        const pageResult = await fetchUploadJson<{ id?: string }>("/api/documents/" + currentDocumentId + "/pages", { method: "POST", body: form });
        if (!pageResult.id) throw new Error(`第 ${pageNumber} 页保存失败`);
        patchTask(taskId, { completedPages: pageNumber, message: `页面证据已安全保存（${pageNumber}/${pageCount}）…` });
      });
      try {
        await ensureModelReady(profileId);
      } catch (error) {
        patchTask(taskId, { stage: "waiting_model", message: (error instanceof Error ? error.message : "识题模型尚未配置") + " 原卷和分页图已经安全保存，可配置模型后在审核页重试识别。" });
        router.refresh();
        return;
      }
      await fetchUploadJson(`/api/documents/${currentDocumentId}/queue`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retry: true, profileId }),
      });
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

  function chooseFiles(files: File[]) {
    if (batchActive || submitting) return;
    setFileError("");
    if (files.some(file => !file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf")) {
      setFileError("仅支持 PDF 试卷，请移除其他格式的文件后重新选择。");
      return;
    }
    const combined = [...selectedFiles];
    for (const file of files) {
      if (!combined.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) combined.push(file);
    }
    if (combined.length > 100) { setFileError("每批最多导入 100 份试卷，请分批上传。"); return; }
    if (combined.some(file => file.size === 0)) { setFileError("文件为空，请选择有效的 PDF 试卷。"); return; }
    if (combined.some(file => file.size > 100 * 1024 * 1024)) { setFileError("单份原卷不能超过 100 MB，请压缩后上传。"); return; }
    setSelectedFiles(combined);
  }

  async function startImport() {
    if (!selectedFiles.length || uploadDisabled || submitting || modelError) return;
    setSubmitting(true);
    try {
      if (concurrencyDraftDirtyRef.current && !await applyConcurrency()) return;
      const files = [...selectedFiles];
      setSelectedFiles([]);
      setFileError("");
      await processFiles(files);
    } finally { setSubmitting(false); }
  }

  function openDrawer() { setModelLoading(true); setModelFeedback(""); setOpen(true); }
  const selectedModel = modelProfiles.find(profile => profile.id === selectedProfileId);
  const unconfiguredModel = !modelLoading && !modelError && !selectedModel?.apiKeyMask;
  const pendingTasks = tasks.filter(task => !["done", "error", "waiting_model"].includes(task.stage)).length;
  const uploadInBrowser = batchActive || submitting;

  return <>
    {tasks.length > 0 && <button type="button" className="wb-button wb-quiet" onClick={openDrawer}>{working && <LoaderCircle size={14} className="spin" />}导入任务{pendingTasks ? ` · ${pendingTasks}` : ""}</button>}
    <button type="button" className="wb-button wb-primary" onClick={openDrawer}><Plus size={16} />导入试卷</button>
    <WorkbenchDialog open={open} drawer titleId="import-title" onClose={() => setOpen(false)}>
      <header className="wb-dialog-header"><div><h2 id="import-title">导入试卷</h2><p>批量上传 PDF，识别后进入待审核列表</p></div><button type="button" className="wb-icon-button" aria-label="关闭导入" onClick={() => setOpen(false)}><X size={19} /></button></header>
      <div className="wb-dialog-body">
        <fieldset className="wb-import-fields" disabled={uploadInBrowser}>
          <legend className="wb-sr-only">试卷信息</legend>
          <div className="wb-field-pair">
            <div className="wb-field"><label htmlFor="import-stage">学段</label><select id="import-stage" value={stage} onChange={event => setStage(event.target.value as EducationStage)}>{educationStages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            <div className="wb-field"><label htmlFor="import-subject">学科</label><select id="import-subject" value={subject} onChange={event => setSubject(event.target.value)}>{subjects.map(item => <option key={item}>{item}</option>)}</select></div>
          </div>
          <div className="wb-field"><label htmlFor="import-grade">年级</label><select id="import-grade" value={effectiveGrade} onChange={event => setUploadGrade(event.target.value)}>{gradesByStage[stage].map(grade => <option key={grade}>{grade}</option>)}</select></div>
          <div className="wb-field"><div className="wb-field-heading"><span>教学 Skill</span><Link href="/settings/skills">查看与定制</Link></div><div className="wb-field-note">自动使用当前年级、学科已启用的个人 Skill；未设置时使用默认规则。{teachingProfile.textbook && <span>教材：{teachingProfile.textbook}</span>}</div></div>
          <div className="wb-field"><div className="wb-field-heading"><label htmlFor="import-model">识别模型</label><Link href="/settings/models">管理模型</Link></div>
            <select id="import-model" aria-label="选择识别模型" value={selectedProfileId} disabled={modelLoading || modelSaving || modelProfiles.length === 0} onChange={event => void selectModel(event.target.value)}>
              {modelProfiles.length === 0 && <option value="">{modelLoading ? "正在读取模型…" : "暂无可用模型"}</option>}
              {modelProfiles.map(profile => <option value={profile.id} key={profile.id}>{profile.displayName}</option>)}
            </select>
            {modelFeedback && <p className={modelError ? "wb-field-error" : "wb-field-hint"} role="status">{modelFeedback}</p>}
            {unconfiguredModel && <p className="wb-field-hint">{selectedModel ? "当前模型尚未配置 API Key。" : "尚未配置识别模型。"}可先上传并保存原卷，配置模型后在试卷详情继续识别。</p>}
          </div>
        </fieldset>
        <div className="wb-field wb-concurrency"><div className="wb-field-heading"><label htmlFor="import-concurrency">并行试卷数</label><span>已应用 {appliedConcurrency} 份</span></div>
          <div className="wb-input-action"><input id="import-concurrency" aria-label="同时处理试卷数" type="number" inputMode="numeric" min="1" max={MAX_UPLOAD_CONCURRENCY} value={concurrencyDraft} onChange={event => { concurrencyDraftDirtyRef.current = true; setConcurrencyDraft(event.target.value); setConcurrencyFeedback(""); }} onKeyDown={event => { if (event.key === "Enter") void applyConcurrency(); }} /><button type="button" className="wb-button" disabled={concurrencySaving} onClick={() => void applyConcurrency()}>{concurrencySaving ? "应用中…" : "应用"}</button></div>
          <p className="wb-field-hint">同时上传和识别的试卷上限，支持 1–{MAX_UPLOAD_CONCURRENCY} 份。</p>
          {concurrencyFeedback && <p role="status" className={concurrencyError ? "wb-field-error" : "wb-field-hint"}>{concurrencyFeedback}</p>}
          {queuePaused && <p className="wb-field-hint" title={queuePauseReason}>识别队列已暂停，可在“待处理”列表中继续。</p>}
          {(queueCounts.active > 0 || queueCounts.queued > 0) && <p className="wb-field-hint">处理中 {queueCounts.active} 份 · 等待 {queueCounts.queued} 份</p>}
        </div>
        <div className="wb-field"><span>PDF 文件</span>
          <input ref={inputRef} className="wb-sr-only" type="file" multiple accept=".pdf,application/pdf" aria-label="选择 PDF 文件" disabled={uploadInBrowser} onChange={event => { chooseFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
          <button type="button" className={`wb-drop-zone${dragging ? " dragging" : ""}`} disabled={uploadInBrowser} onClick={() => inputRef.current?.click()} onDragOver={event => { event.preventDefault(); if (!uploadInBrowser) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFiles(Array.from(event.dataTransfer.files)); }}>
            <UploadCloud size={26} /><strong>点击选择或拖放 PDF</strong><span>支持多选，每批最多 100 份</span>
          </button>
          {fileError && <p role="alert" className="wb-field-error">{fileError}</p>}
          {selectedFiles.length > 0 && <div className="wb-file-selection"><div><strong>已选 {selectedFiles.length} 份</strong><button className="wb-text-button" type="button" disabled={uploadInBrowser} onClick={() => setSelectedFiles([])}>清空</button></div><ul>{selectedFiles.map((file, index) => <li key={`${file.name}-${file.lastModified}`}><FileText size={16} /><span title={file.name}>{file.name}<small>{file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.size / 1024))} KB`}</small></span><button type="button" className="wb-icon-button" aria-label={`移除 ${file.name}`} disabled={uploadInBrowser} onClick={() => setSelectedFiles(files => files.filter((_, i) => i !== index))}><X size={15} /></button></li>)}</ul></div>}
        </div>
        {tasks.length > 0 && <section className="wb-upload-tasks" aria-label="导入任务"><h3>导入任务 <span>{tasks.length}</span></h3>
          {uploadInBrowser && <p className="wb-field-hint">可关闭抽屉查看列表；原卷上传完成前，请保持此页面打开。</p>}
          {taskSyncError && <p className="wb-field-error" role="status">{taskSyncError}</p>}
          <div aria-live="polite">{tasks.map(task => <article key={task.id} className={task.stage === "error" ? "error" : ""}>
            {task.stage === "done" ? <CheckCircle2 size={16} /> : task.stage === "error" ? <AlertCircle size={16} /> : ["idle", "rendering", "preparing", "uploading", "queued", "extracting", "retry_wait"].includes(task.stage) ? <LoaderCircle size={16} className="spin" /> : <FileText size={16} />}
            <div><strong title={task.fileName}>{task.fileName}</strong><p>{task.message}</p>{task.documentId && <Link href={`/review/${task.documentId}`}>{task.stage === "done" ? "前往审核" : "查看试卷"}</Link>}</div>
          </article>)}</div>
        </section>}
      </div>
      <footer className="wb-dialog-footer"><span>{selectedFiles.length ? `已选 ${selectedFiles.length} 份 PDF` : uploadInBrowser ? "正在安全保存原卷…" : tasks.length ? "任务进度自动保存" : "选择文件后开始导入"}</span><button type="button" className="wb-button" onClick={() => setOpen(false)}>{tasks.length ? "关闭" : "取消"}</button><button type="button" className="wb-button wb-primary" disabled={!selectedFiles.length || uploadDisabled || submitting || modelError || concurrencySaving} onClick={() => void startImport()}>{uploadInBrowser ? <LoaderCircle size={15} className="spin" /> : <UploadCloud size={15} />}{uploadInBrowser ? "导入中…" : "开始导入"}</button></footer>
    </WorkbenchDialog>
  </>;
}
