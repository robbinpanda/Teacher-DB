"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LibraryBig, FileText, LoaderCircle, Plus, UploadCloud, X } from "lucide-react";
import { educationStages, gradesByStage, stageFromGrade, stageLabel } from "../lib/education-taxonomy";
import { createDynamicConcurrencyController, DEFAULT_UPLOAD_CONCURRENCY, MAX_UPLOAD_CONCURRENCY } from "../lib/upload-concurrency";
import { useEducationScope } from "./AppShell";
import { fetchUploadJson } from "../lib/upload-request";
import { uploadResponseSchema } from "../lib/api-contracts";
import { persistPendingUploads, readPendingUploads, removePendingUpload, type PendingUpload } from "../lib/pending-uploads";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { MAX_IMPORT_BATCH_SIZE } from "../lib/import-paper-name";
import { browserPdfConcurrency, renderPdfPages, PDF_RESOURCE_OPTIONS, type RenderedPage } from "../lib/pdf-render";
import { reportBrowserRuntime, changeActivePdfCount } from "../lib/browser-runtime";

type Stage = "idle" | "rendering" | "uploading" | "error";
type UploadTask = { id: string; fileName: string; stage: Stage; message: string; pageCount: number; completedPages: number; questionTotal?: number | null; completedQuestionCount?: number; documentId?: string; renderer?: string; modelDisplayName?: string };
type QueueSnapshot = {
  concurrency?: number;
  activeCount?: number;
  queuedCount?: number;
  paused?: boolean;
  pauseReason?: string | null;
  pausedCount?: number;
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

async function renderPdf(
  file: File,
  onReady: (pageCount: number) => Promise<void>,
  onPage: (page: RenderedPage, pageNumber: number, pageCount: number) => Promise<void>,
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  changeActivePdfCount(1);
  reportBrowserRuntime("pdf_start");
  try {
    await renderPdfPages(pdfjs.getDocument({ ...PDF_RESOURCE_OPTIONS, data: await file.arrayBuffer(), canvasMaxAreaInBytes: 32 * 1024 * 1024 }), onReady, onPage);
  } catch (error) {
    reportBrowserRuntime("pdf_error");
    throw error;
  } finally {
    changeActivePdfCount(-1);
    reportBrowserRuntime("pdf_end");
  }
}

export function UploadWorkbench({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const router = useRouter();
  const [recoverable, setRecoverable] = useState<PendingUpload[]>([]);
  const { subject, stage } = useEducationScope();
  useEffect(() => { void readPendingUploads().then(items => setRecoverable(items.filter(item => item.metadata.subject === subject && stageFromGrade(item.metadata.grade) === stage))).catch(() => undefined); }, [subject, stage]);
  const [open, setOpen] = useState(initiallyOpen);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const concurrencyRef = useRef(DEFAULT_UPLOAD_CONCURRENCY);
  const concurrencyDraftDirtyRef = useRef(false);
  const batchControllerRef = useRef<{ setConcurrency: (value: unknown) => void } | null>(null);
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [importNotice, setImportNotice] = useState("");
  const [namingWarnings, setNamingWarnings] = useState<string[]>([]);
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
  const targetBank = `${stageLabel(stage)} · ${subject}`;
  const sourceMeta = {
    subject,
    grade: effectiveGrade,
    sourceYear: "",
    sourceExamType: "",
    sourceRegion: teachingProfile.region === "全国" ? "" : teachingProfile.region,
    sourceTextbook: teachingProfile.textbook,
    sourceSchool: "",
  };
  const uploadDisabled = batchActive || modelLoading || modelSaving;

  function syncQueueSettings(result: QueueSnapshot, syncDraft = false) {
    if (typeof result.concurrency === "number") {
      concurrencyRef.current = result.concurrency;
      setAppliedConcurrency(result.concurrency);
      batchControllerRef.current?.setConcurrency(browserPdfConcurrency(result.concurrency));
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
    void fetch("/api/extraction-queue?summary=1", { cache: "no-store" })
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

  function handOffTask(taskId: string) {
    void removePendingUpload(taskId).then(() => setRecoverable(items => items.filter(item => item.id !== taskId))).catch(() => undefined);
    setTasks(items => items.filter(item => item.id !== taskId));
    setImportNotice(`原卷已保存到「${targetBank}」，后续分页、识别和审核进度请在试卷管理中查看。`);
  }

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
    patchTask(taskId, { stage: "uploading", message: "正在保存原卷并整理试卷名称…" });
    const uploadUrl = `/api/documents?${new URLSearchParams({ subject: metadata.subject, stage: stageFromGrade(metadata.grade) })}`;
    let persistedDocumentId: string | undefined;
    try {
      const provisional = new FormData();
      provisional.append("file", file);
      provisional.append("pageCount", "0");
      if (profileId) provisional.append("profileId", profileId);
      Object.entries(metadata).forEach(([key, value]) => provisional.append(key, value));
      const provisionalResult = uploadResponseSchema.parse(await fetchUploadJson(uploadUrl, { method: "POST", body: provisional }));
      if (!provisionalResult.id) throw new Error("原卷预登记失败");
      if (provisionalResult.namingWarning) setNamingWarnings(previous => [...previous, `${file.name}：${provisionalResult.namingWarning}`]);
      if (provisionalResult.name) patchTask(taskId, { fileName: provisionalResult.name });
      const currentDocumentId = provisionalResult.id;
      persistedDocumentId = currentDocumentId;
      patchTask(taskId, { documentId: currentDocumentId });
      router.refresh();
      if (provisionalResult.status === "complete") {
        handOffTask(taskId);
        return;
      }
      if (provisionalResult.preparationQueued) {
        handOffTask(taskId);
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
        const documentResult = await fetchUploadJson<{ id?: string }>(uploadUrl, { method: "POST", body: original });
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
        const message = (error instanceof Error ? error.message : "识题模型尚未配置") + " 原卷和分页图已经安全保存，请选择模型后开始识别。";
        await fetchUploadJson(`/api/documents/${currentDocumentId}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "awaiting_model", error: message }),
        });
        handOffTask(taskId);
        router.refresh();
        return;
      }
      await fetchUploadJson(`/api/documents/${currentDocumentId}/queue`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retry: true, profileId }),
      });
      handOffTask(taskId);
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
    if (files.length > MAX_IMPORT_BATCH_SIZE) { setFileError(`每批最多导入 ${MAX_IMPORT_BATCH_SIZE} 份试卷，请分批上传。`); return; }
    setNamingWarnings([]);
    setBatchActive(true);
    const metadata = { ...sourceMeta };
    const batchProfileId = selectedProfileId || undefined;
    const batchProfile = modelProfiles.find((profile) => profile.id === batchProfileId);
    const queued = files.map((file) => ({ id: crypto.randomUUID(), file, fileName: file.name, metadata, profileId: batchProfileId }));
    try { await persistPendingUploads(queued); }
    catch { setBatchActive(false); setSelectedFiles(files); setFileError("浏览器无法保存待上传文件，请释放本地空间后重试；文件尚未开始上传。"); return; }
    setRecoverable(queued);
    setImportNotice("");
    setTasks(queued.map((item) => ({
      id: item.id, fileName: item.file.name, stage: "idle" as Stage, message: "等待处理…", pageCount: 0, completedPages: 0,
      modelDisplayName: batchProfile?.displayName,
    })));
    const controller = createDynamicConcurrencyController(
      queued,
      browserPdfConcurrency(concurrencyRef.current),
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

  async function resumePendingUploads() {
    if (batchActive || !recoverable.length) return;
    setBatchActive(true);
    const queued = [...recoverable];
    setTasks(queued.map(item => ({ id: item.id, fileName: item.fileName, stage: "idle", message: "等待恢复导入…", pageCount: 0, completedPages: 0 })));
    const controller = createDynamicConcurrencyController(queued, browserPdfConcurrency(concurrencyRef.current), item => processFile(new File([item.file], item.fileName, { type: item.file.type || "application/pdf" }), item.id, item.metadata, item.profileId));
    batchControllerRef.current = controller;
    try { await controller.promise; }
    finally { batchControllerRef.current = null; setBatchActive(false); }
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
    if (combined.length > MAX_IMPORT_BATCH_SIZE) { setFileError(`每批最多导入 ${MAX_IMPORT_BATCH_SIZE} 份试卷，请分批上传。`); return; }
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

  function openDrawer() {
    if (!batchActive && !submitting) { setTasks([]); setImportNotice(""); }
    setModelLoading(true); setModelFeedback(""); setOpen(true);
  }
  const selectedModel = modelProfiles.find(profile => profile.id === selectedProfileId);
  const unconfiguredModel = !modelLoading && !modelError && !selectedModel?.apiKeyMask;
  const uploadInBrowser = batchActive || submitting;

  return <>
    {recoverable.length > 0 && !batchActive && <button className="wb-button" type="button" onClick={() => { setOpen(true); void resumePendingUploads(); }}>恢复未完成导入（{recoverable.length}）</button>}
    {uploadInBrowser && <button type="button" className="wb-button wb-quiet" onClick={openDrawer}><LoaderCircle size={14} className="spin" />正在导入 · {tasks.length}</button>}
    <button ref={triggerRef} type="button" className="wb-button wb-primary" onClick={openDrawer}><Plus size={16} />导入试卷</button>
    <WorkbenchDialog open={open} className="wb-import-dialog" titleId="import-title" returnFocusRef={triggerRef} onClose={() => setOpen(false)}>
      <header className="wb-dialog-header"><div><h2 id="import-title">导入试卷</h2><p>批量上传 PDF，识别后进入待审核列表</p></div><button type="button" className="wb-icon-button" aria-label="关闭导入" onClick={() => setOpen(false)}><X size={19} /></button></header>
      <div className="wb-dialog-body wb-import-layout">
        <section className="wb-import-settings" aria-labelledby="import-settings-title">
          <section className="wb-import-destination" aria-label="目标题库">
            <LibraryBig size={22} aria-hidden="true" /><div><span>目标题库</span><strong>{targetBank}</strong><p>本批试卷自动归入此题库。要更换目标，请关闭窗口后在侧栏切换学科或学段。</p></div>
          </section>
          <div className="wb-import-section-heading"><h3 id="import-settings-title">识别设置</h3><p>选择当前学段内的年级与识别方式</p></div>
        <fieldset className="wb-import-fields" disabled={uploadInBrowser}>
          <legend className="wb-sr-only">试卷信息</legend>
          <div className="wb-field"><label htmlFor="import-grade">年级</label><select id="import-grade" value={effectiveGrade} onChange={event => setUploadGrade(event.target.value)}>{gradesByStage[stage].map(grade => <option key={grade}>{grade}</option>)}</select></div>
          <div className="wb-field"><div className="wb-field-heading"><span>教学 Skill</span><Link href="/settings/skills">查看与定制</Link></div><div className="wb-field-note">自动使用当前年级、学科已启用的个人 Skill；未设置时使用默认规则。{teachingProfile.textbook && <span>教材：{teachingProfile.textbook}</span>}</div></div>
          <div className="wb-field"><div className="wb-field-heading"><label htmlFor="import-model">识别模型</label><Link href="/settings/models">管理模型</Link></div>
            <select id="import-model" aria-label="选择识别模型" value={selectedProfileId} disabled={modelLoading || modelSaving || modelProfiles.length === 0} onChange={event => void selectModel(event.target.value)}>
              <option value="" disabled>{modelLoading ? "正在读取模型…" : modelProfiles.length ? "请选择识别模型" : "暂无可用模型"}</option>
              {modelProfiles.map(profile => <option value={profile.id} key={profile.id}>{profile.displayName}</option>)}
            </select>
            {modelFeedback && <p className={modelError ? "wb-field-error" : "wb-field-hint"} role="status">{modelFeedback}</p>}
            {unconfiguredModel && <p className="wb-field-hint">{selectedModel ? "当前模型尚未配置 API Key。" : modelProfiles.length ? "尚未选择识别模型。" : "尚未配置识别模型。"}可先上传并保存原卷，配置模型后在试卷详情继续识别。</p>}
          </div>
        </fieldset>
        <div className="wb-field wb-concurrency"><div className="wb-field-heading"><label htmlFor="import-concurrency">并行试卷数</label><span>已应用 {appliedConcurrency} 份</span></div>
          <div className="wb-input-action"><input id="import-concurrency" aria-label="同时处理试卷数" type="number" inputMode="numeric" min="1" max={MAX_UPLOAD_CONCURRENCY} value={concurrencyDraft} onChange={event => { concurrencyDraftDirtyRef.current = true; setConcurrencyDraft(event.target.value); setConcurrencyFeedback(""); }} onKeyDown={event => { if (event.key === "Enter") void applyConcurrency(); }} /><button type="button" className="wb-button" disabled={concurrencySaving} onClick={() => void applyConcurrency()}>{concurrencySaving ? "应用中…" : "应用"}</button></div>
          <p className="wb-field-hint">后台同时识别的试卷上限，支持 1–{MAX_UPLOAD_CONCURRENCY} 份。浏览器上传和分页最多同时 2 份，避免内存耗尽。</p>
          {concurrencyFeedback && <p role="status" className={concurrencyError ? "wb-field-error" : "wb-field-hint"}>{concurrencyFeedback}</p>}
          {queuePaused && <p className="wb-field-hint" title={queuePauseReason}>识别队列已暂停，可在“待处理”列表中继续。</p>}
          {(queueCounts.active > 0 || queueCounts.queued > 0) && <p className="wb-field-hint">处理中 {queueCounts.active} 份 · 等待 {queueCounts.queued} 份</p>}
        </div>
        </section>
        <section className="wb-import-files" aria-labelledby="import-files-title">
          <div className="wb-import-section-heading"><h3 id="import-files-title">试卷文件</h3><p>批量添加试卷，确认文件后开始导入</p></div>
        <div className="wb-field wb-import-upload"><span>PDF 文件</span>
          <input ref={inputRef} className="wb-sr-only" type="file" multiple accept=".pdf,application/pdf" aria-label="选择 PDF 文件" disabled={uploadInBrowser} onChange={event => { chooseFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
          <button type="button" className={`wb-drop-zone${dragging ? " dragging" : ""}`} disabled={uploadInBrowser} onClick={() => inputRef.current?.click()} onDragOver={event => { event.preventDefault(); if (!uploadInBrowser) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFiles(Array.from(event.dataTransfer.files)); }}>
            <UploadCloud size={26} /><strong>点击选择或拖放 PDF</strong><span>支持多选，每批最多 {MAX_IMPORT_BATCH_SIZE} 份</span>
          </button>
          {fileError && <p role="alert" className="wb-field-error">{fileError}</p>}
          <p className="wb-field-hint">默认由 MiMo 2.6 Flash 根据文件名整理为“年份＋一模/二模＋区域”或“年份＋学校＋期中/期末/月考/周考”。缺失信息留空，其他类型保留原名。</p>
          {selectedFiles.length > 0 && <div className="wb-file-selection"><div><strong>已选 {selectedFiles.length} 份</strong><button className="wb-text-button" type="button" disabled={uploadInBrowser} onClick={() => setSelectedFiles([])}>清空</button></div><ul>{selectedFiles.map((file, index) => <li key={`${file.name}-${file.lastModified}`}><FileText size={16} /><span title={file.name}>{file.name}<small>{file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.size / 1024))} KB`}</small></span><button type="button" className="wb-icon-button" aria-label={`移除 ${file.name}`} disabled={uploadInBrowser} onClick={() => setSelectedFiles(files => files.filter((_, i) => i !== index))}><X size={15} /></button></li>)}</ul></div>}
        </div>
        {importNotice && <p className="wb-field-hint" role="status">{importNotice}</p>}
        {namingWarnings.length > 0 && <details className="wb-field-hint"><summary>{namingWarnings.length} 份试卷未能自动整理名称，已保留原名</summary><ul>{namingWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        {tasks.length > 0 && <section className="wb-upload-tasks" aria-label="导入任务"><h3>导入任务 <span>{tasks.length}</span></h3>
          {uploadInBrowser && <p className="wb-field-hint">可关闭导入窗口查看列表；原卷上传完成前，请保持此页面打开。</p>}
          <div aria-live="polite">{tasks.map(task => <article key={task.id} className={task.stage === "error" ? "error" : ""}>
            {task.stage === "error" ? <AlertCircle size={16} /> : <LoaderCircle size={16} className="spin" />}
            <div><strong title={task.fileName}>{task.fileName}</strong><p>{task.message}</p>{task.documentId && <Link href={`/review/${task.documentId}`}>查看试卷</Link>}</div>
          </article>)}</div>
        </section>}
        </section>
      </div>
      <footer className="wb-dialog-footer"><span>目标：{targetBank} · {selectedFiles.length ? `已选 ${selectedFiles.length} 份 PDF` : uploadInBrowser ? "正在安全保存原卷…" : tasks.length ? "部分文件导入失败，请查看提示" : importNotice ? "后续进度请在试卷管理中查看" : "选择文件后开始导入"}</span><button type="button" className="wb-button" onClick={() => setOpen(false)}>{tasks.length || importNotice ? "关闭" : "取消"}</button><button type="button" className="wb-button wb-primary" disabled={!selectedFiles.length || uploadDisabled || submitting || modelError || concurrencySaving} onClick={() => void startImport()}>{uploadInBrowser ? <LoaderCircle size={15} className="spin" /> : <UploadCloud size={15} />}{uploadInBrowser ? "导入中…" : "开始导入"}</button></footer>
    </WorkbenchDialog>
  </>;
}
