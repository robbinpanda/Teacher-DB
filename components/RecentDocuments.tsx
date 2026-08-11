"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, Check, Clock3, FileX2, ListChecks, LoaderCircle, Pause, Play, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import type { SourceDocument } from "../lib/types";

type DocumentGroup = "preprocessing" | "pending_review" | "reviewed";
type QueueControlState = {
  paused: boolean;
  pauseReason: string | null;
  pausedCount: number;
  activeCount: number;
  queuedCount: number;
};

const groupMeta: Array<{ id: DocumentGroup; title: string; description: string; empty: string }> = [
  { id: "preprocessing", title: "AI 预处理中", description: "上传、排队、识别、退避或暂停中的试卷", empty: "暂无正在处理的试卷" },
  { id: "pending_review", title: "待审核", description: "AI 已完成识别，等待人工逐题确认", empty: "暂无待审核试卷" },
  { id: "reviewed", title: "已入库", description: "全部题目已完成确认并进入题库", empty: "暂无已入库试卷" },
];

function documentGroup(document: SourceDocument): DocumentGroup {
  if (document.completedPageCount < document.pageCount) return "preprocessing";
  if (document.status === "complete") return "reviewed";
  if (document.status === "reviewing") return "pending_review";
  return "preprocessing";
}

export function RecentDocuments({ initialDocuments }: { initialDocuments: SourceDocument[] }) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [activeGroup, setActiveGroup] = useState<DocumentGroup>(() => {
    if (initialDocuments.some((document) => documentGroup(document) === "pending_review")) return "pending_review";
    if (initialDocuments.some((document) => documentGroup(document) === "preprocessing")) return "preprocessing";
    if (initialDocuments.some((document) => documentGroup(document) === "reviewed")) return "reviewed";
    return "preprocessing";
  });
  const [target, setTarget] = useState<SourceDocument | null>(null);
  const [deletingMode, setDeletingMode] = useState<"with_questions" | "source_only" | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchAction, setBatchAction] = useState<"approve" | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [queueState, setQueueState] = useState<QueueControlState>({ paused: false, pauseReason: null, pausedCount: 0, activeCount: 0, queuedCount: 0 });
  const [queueBusy, setQueueBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const [response, queueResponse] = await Promise.all([
          fetch("/api/documents", { cache: "no-store" }),
          fetch("/api/extraction-queue", { cache: "no-store" }),
        ]);
        const result = await response.json().catch(() => ({})) as { documents?: SourceDocument[]; error?: string };
        const queue = await queueResponse.json().catch(() => ({})) as Partial<QueueControlState> & { error?: string };
        if (!response.ok || !result.documents) throw new Error(result.error ?? "无法更新试卷状态");
        if (!queueResponse.ok) throw new Error(queue.error ?? "无法更新识别队列状态");
        if (!cancelled) {
          setDocuments(result.documents);
          setQueueState({
            paused: Boolean(queue.paused),
            pauseReason: queue.pauseReason ?? null,
            pausedCount: Number(queue.pausedCount ?? 0),
            activeCount: Number(queue.activeCount ?? 0),
            queuedCount: Number(queue.queuedCount ?? 0),
          });
          const currentIds = new Set(result.documents.map((item) => item.id));
          setSelectedIds((ids) => new Set(Array.from(ids).filter((id) => currentIds.has(id))));
          setListError("");
        }
      } catch (caught) {
        if (!cancelled) setListError(caught instanceof Error ? caught.message : "无法更新试卷状态");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const onVisibilityChange = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  async function controlQueue(action: "pause" | "resume") {
    setQueueBusy(true);
    setListError("");
    setBatchNotice("");
    try {
      const response = await fetch("/api/extraction-queue", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({})) as QueueControlState & { changed?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? (action === "pause" ? "暂停队列失败" : "启动队列失败"));
      setQueueState(result);
      setDocuments((items) => items.map((item) => {
        if (documentGroup(item) !== "preprocessing") return item;
        if (action === "pause" && item.jobStatus !== "processing") {
          return { ...item, status: "extracting", jobStatus: "paused", nextAttemptAt: null };
        }
        if (action === "resume" && ["paused", "retry_wait", "failed", "queued"].includes(item.jobStatus ?? "")) {
          return { ...item, status: "extracting", jobStatus: "queued", jobAttempt: 0, nextAttemptAt: null, lastError: null, failedPageCount: 0 };
        }
        return item;
      }));
      setBatchNotice(action === "pause"
        ? `已暂停全部识别任务；${result.activeCount ? `当前 ${result.activeCount} 份会在本页安全收尾后停止。` : "当前没有仍在运行的任务。"}`
        : `已重新开始 ${result.changed ?? 0} 份未完成试卷，长退避和失败计数已清除。`);
      router.refresh();
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "识别队列操作失败");
    } finally {
      setQueueBusy(false);
    }
  }

  async function retryDocument(document: SourceDocument) {
    setRetryingIds((ids) => new Set(ids).add(document.id));
    setListError("");
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(document.id)}/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retry: true }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "重新加入识别队列失败");
      setDocuments((items) => items.map((item) => item.id === document.id
        ? { ...item, status: "extracting", jobStatus: "queued", jobAttempt: 0, nextAttemptAt: null, lastError: null, failedPageCount: 0 }
        : item));
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "重试失败");
    } finally {
      setRetryingIds((ids) => {
        const next = new Set(ids);
        next.delete(document.id);
        return next;
      });
    }
  }

  async function removeDocument(mode: "with_questions" | "source_only") {
    if (!target) return;
    setDeletingMode(mode);
    setError("");
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "删除试卷失败");
      setDocuments((items) => items.filter((document) => document.id !== target.id));
      setTarget(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除试卷失败");
    } finally {
      setDeletingMode(null);
    }
  }

  async function approveSelectedDocuments() {
    const documentIds = Array.from(selectedIds);
    if (!documentIds.length) return;
    setBatchAction("approve");
    setListError("");
    setBatchNotice("");
    try {
      const response = await fetch("/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve_without_review", documentIds }),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        changed?: number;
        completedDocuments?: number;
        reviewRequired?: number;
        documents?: Array<{ id: string; status: "reviewing" | "complete"; total: number; approved: number }>;
      };
      if (!response.ok || !result.documents) throw new Error(result.error ?? "批量完成失败");
      const updates = new Map(result.documents.map((document) => [document.id, document]));
      setDocuments((items) => items.map((item) => {
        const update = updates.get(item.id);
        return update ? { ...item, status: update.status, questionCount: update.total, approvedCount: update.approved } : item;
      }));
      setBatchNotice(`已自动入库 ${result.changed ?? 0} 道无需人工核查的题目；${result.completedDocuments ?? 0} 份试卷已全部完成${result.reviewRequired ? `，仍有 ${result.reviewRequired} 道需人工复核` : ""}。`);
      setSelectedIds(new Set());
      setSelectionMode(false);
      router.refresh();
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "批量完成失败");
    } finally {
      setBatchAction(null);
    }
  }

  async function removeSelectedDocuments(mode: "with_questions" | "source_only") {
    const documentIds = Array.from(selectedIds);
    if (!documentIds.length) return;
    setDeletingMode(mode);
    setError("");
    try {
      const response = await fetch("/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", documentIds, mode }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; deleted?: number; fileDeleteFailures?: number };
      if (!response.ok) throw new Error(result.error ?? "批量删除试卷失败");
      const deleted = new Set(documentIds);
      setDocuments((items) => items.filter((document) => !deleted.has(document.id)));
      setBatchDeleteOpen(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      setBatchNotice(`已删除 ${result.deleted ?? documentIds.length} 份试卷${result.fileDeleteFailures ? `，${result.fileDeleteFailures} 个文件等待后续清理` : ""}。`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量删除试卷失败");
    } finally {
      setDeletingMode(null);
    }
  }

  function toggleDocument(documentId: string) {
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function moveGroupFocus(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? groupMeta.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + groupMeta.length) % groupMeta.length;
    setActiveGroup(groupMeta[nextIndex].id);
    setSelectedIds(new Set());
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIndex]?.focus();
  }

  function renderDocument(doc: SourceDocument) {
    const recognitionProgress = doc.pageCount ? Math.round(doc.completedPageCount / doc.pageCount * 100) : 0;
    const reviewed = documentGroup(doc) === "reviewed";
    const progress = doc.status === "reviewing" || reviewed
      ? (doc.questionCount ? Math.round(doc.approvedCount / doc.questionCount * 100) : 0)
      : recognitionProgress;
    const retrying = retryingIds.has(doc.id);
    const blocked = doc.jobStatus === "failed" || doc.jobStatus === "paused";
    const pagesFinished = doc.pageCount > 0 && doc.completedPageCount >= doc.pageCount;
    const selected = selectedIds.has(doc.id);
    const modelLabel = doc.modelDisplayName ?? doc.modelName ?? "模型记录缺失";
    const queueLabel = doc.jobStatus === "paused"
      ? "已暂停 · 等待全部开始"
      : doc.jobStatus === "failed"
        ? pagesFinished
          ? "识别完成 · 收尾校验未通过"
          : `识别失败 · 第 ${doc.jobAttempt ?? 1} 次`
      : doc.jobStatus === "retry_wait"
        ? `退避中${doc.nextAttemptAt ? ` · ${new Date(doc.nextAttemptAt).toLocaleTimeString("zh-CN")} 自动继续` : ""}`
        : doc.jobStatus === "queued"
          ? `队列等待 · 已识别 ${doc.completedPageCount}/${doc.pageCount} 页`
          : doc.jobStatus === "processing"
            ? `AI 识别 · 已完成 ${doc.completedPageCount}/${doc.pageCount} 页`
            : null;
    const statusLabel = queueLabel ?? (doc.status === "uploading"
      ? "原卷页面预处理中"
      : doc.status === "extracting"
        ? `等待识别 · ${doc.completedPageCount}/${doc.pageCount} 页`
        : doc.status === "failed"
          ? `处理已暂停 · 已完成 ${doc.completedPageCount}/${doc.pageCount} 页`
          : reviewed
            ? `已入库 ${doc.approvedCount}/${doc.questionCount}`
            : `待审核 · 已确认 ${doc.approvedCount}/${doc.questionCount}`);
    const href = doc.status === "uploading" ? "/" : `/review/${doc.id}`;
    return (
      <div className={`document-row-wrap ${blocked ? "paused" : ""} ${selectionMode ? "selection-active" : ""} ${selected ? "selected" : ""}`} key={doc.id}>
        {selectionMode && <label className="document-selector" aria-label={`选择 ${doc.name}`}><input type="checkbox" checked={selected} onChange={() => toggleDocument(doc.id)} /></label>}
        <Link href={href} className="document-row card" onClick={selectionMode ? (event) => { event.preventDefault(); toggleDocument(doc.id); } : undefined}>
          <span className={`document-icon ${doc.subject}`}>{doc.subject.slice(0, 1)}</span>
          <div className="document-main"><strong>{doc.name}</strong><span><Clock3 size={12} /> {new Date(doc.createdAt).toLocaleString("zh-CN")} · {doc.pageCount} 页 · {doc.grade}</span><span className="document-model" title={doc.modelName && doc.modelName !== modelLabel ? `${modelLabel}（${doc.modelName}）` : modelLabel}><Sparkles size={11} /> 识别模型 · {modelLabel}</span></div>
          <div className="document-progress" title={doc.lastError ?? undefined}><div><span>{statusLabel}</span><b>{progress}%</b></div><div className="progress"><span style={{ width: `${progress}%` }} /></div></div>
          <ArrowRight size={17} className="row-arrow" />
        </Link>
        {!selectionMode && <div className="document-actions">
          {doc.jobStatus === "failed" && <button type="button" className="document-retry" disabled={retrying} title={pagesFinished ? "重新执行收尾校验" : "重新识别未完成页面"} aria-label={`重试 ${doc.name}`} onClick={() => void retryDocument(doc)}>{retrying ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button>}
          <button type="button" className="document-delete" title="删除试卷" aria-label={`删除 ${doc.name}`} onClick={() => { setTarget(doc); setError(""); }}><Trash2 size={15} /></button>
        </div>}
      </div>
    );
  }

  const groupCounts = Object.fromEntries(groupMeta.map((group) => [
    group.id,
    documents.filter((document) => documentGroup(document) === group.id).length,
  ])) as Record<DocumentGroup, number>;
  const activeGroupMeta = groupMeta.find((group) => group.id === activeGroup) ?? groupMeta[0];
  const activeDocuments = documents.filter((document) => documentGroup(document) === activeGroup);
  const allActiveSelected = activeDocuments.length > 0 && activeDocuments.every((document) => selectedIds.has(document.id));
  const selectedDocuments = documents.filter((document) => selectedIds.has(document.id));

  function closeDeleteDialog() {
    if (deletingMode) return;
    setTarget(null);
    setBatchDeleteOpen(false);
    setError("");
  }

  return (
    <>
      {listError && <p className="form-error recent-refresh-error"><AlertTriangle size={14} /> {listError}</p>}
      <div className="document-view-switcher" role="tablist" aria-label="试卷处理状态">
        {groupMeta.map((group, index) => (
          <button
            type="button"
            role="tab"
            id={`document-tab-${group.id}`}
            aria-controls="document-status-panel"
            aria-selected={activeGroup === group.id}
            tabIndex={activeGroup === group.id ? 0 : -1}
            key={group.id}
            onClick={() => { setActiveGroup(group.id); setSelectedIds(new Set()); }}
            onKeyDown={(event) => moveGroupFocus(event, index)}
          ><span>{group.title}</span><b>{groupCounts[group.id]}</b></button>
        ))}
      </div>
      <section
        id="document-status-panel"
        className="document-status-panel"
        role="tabpanel"
        aria-labelledby={`document-tab-${activeGroup}`}
        aria-live="polite"
      >
        <div className="document-view-summary">
          <p>{activeGroupMeta.description}</p>
          <div className="document-bulk-toolbar">
            {!selectionMode ? <>
              <span>共 {activeDocuments.length} 份</span>
              {activeGroup === "preprocessing" && activeDocuments.length > 0 && (queueState.paused
                ? <button type="button" className="queue-resume" disabled={queueBusy} onClick={() => void controlQueue("resume")}>{queueBusy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} fill="currentColor" />} 全部开始</button>
                : <button type="button" className="queue-pause" disabled={queueBusy} onClick={() => void controlQueue("pause")}>{queueBusy ? <LoaderCircle className="spin" size={14} /> : <Pause size={14} fill="currentColor" />} 全部暂停</button>)}
              {activeDocuments.length > 0 && <button type="button" onClick={() => { setSelectionMode(true); setBatchNotice(""); }}><ListChecks size={14} /> 批量处理</button>}
            </> : <>
              <button type="button" className="bulk-select-all" onClick={() => setSelectedIds(allActiveSelected ? new Set() : new Set(activeDocuments.map((document) => document.id)))}>{allActiveSelected ? "取消全选" : "全选"}</button>
              <span>已选 {selectedIds.size} 份</span>
              {activeGroup === "pending_review" && <button type="button" className="bulk-complete" disabled={!selectedIds.size || Boolean(batchAction)} onClick={() => void approveSelectedDocuments()}><Check size={14} /> {batchAction === "approve" ? "入库中…" : "完成并自动入库"}</button>}
              <button type="button" className="bulk-delete" disabled={!selectedIds.size || Boolean(batchAction)} onClick={() => { setBatchDeleteOpen(true); setError(""); }}><Trash2 size={14} /> 批量删除</button>
              <button type="button" className="bulk-cancel" disabled={Boolean(batchAction)} onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}>取消</button>
            </>}
          </div>
        </div>
        {queueState.paused && activeGroup === "preprocessing" && <div className="queue-paused-banner" role="status">
          <span><Pause size={16} /></span>
          <div><strong>全部识别已暂停</strong><small>{queueState.pauseReason ?? "修复网络或模型配置后，点击“全部开始”立即继续所有未完成任务。"}</small></div>
          <button type="button" disabled={queueBusy} onClick={() => void controlQueue("resume")}>{queueBusy ? <LoaderCircle className="spin" size={14} /> : <Play size={13} fill="currentColor" />} 全部开始</button>
        </div>}
        {batchNotice && <p className="document-bulk-notice"><Check size={14} /> {batchNotice}</p>}
        <div className="document-list">
          {activeDocuments.map(renderDocument)}
          {!activeDocuments.length && <div className="document-group-empty">{documents.length ? activeGroupMeta.empty : "还没有处理记录，请在上方上传第一份 PDF 试卷。"}</div>}
        </div>
      </section>

      {(target || batchDeleteOpen) && (
        <div className="delete-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeleteDialog(); }}>
          <section className="delete-dialog card" role="dialog" aria-modal="true" aria-labelledby="delete-document-title">
            <button type="button" className="dialog-close" aria-label="关闭" disabled={Boolean(deletingMode)} onClick={closeDeleteDialog}><X size={16} /></button>
            <span className="dialog-icon"><FileX2 size={20} /></span>
            <h2 id="delete-document-title">{target ? "删除试卷" : `批量删除 ${selectedDocuments.length} 份试卷`}</h2>
            <p className="delete-document-name">{target ? target.name : selectedDocuments.slice(0, 3).map((document) => document.name).join("、") + (selectedDocuments.length > 3 ? ` 等 ${selectedDocuments.length} 份` : "")}</p>
            <div className="delete-choice-list">
              <button type="button" disabled={Boolean(deletingMode)} onClick={() => void (target ? removeDocument("with_questions") : removeSelectedDocuments("with_questions"))}>
                <Trash2 size={17} /><span><strong>{deletingMode === "with_questions" ? "正在彻底删除…" : "同步删除试卷和题目"}</strong><small>删除原文件、页面图、全部题目和题图；相关组卷引用也会移除。</small></span>
              </button>
              <button type="button" disabled={Boolean(deletingMode)} onClick={() => void (target ? removeDocument("source_only") : removeSelectedDocuments("source_only"))}>
                <FileX2 size={17} /><span><strong>{deletingMode === "source_only" ? "正在删除试卷来源…" : "只删除试卷，保留已入库题目"}</strong><small>题库中的已入库题目继续保留，但原页面被删除后将无法预览、修改或重新识别。</small></span>
              </button>
            </div>
            <p className="delete-warning"><AlertTriangle size={14} /> 只删除试卷是不可逆操作，保留题目将永久失去原卷编辑能力。</p>
            {error && <p className="form-error">{error}</p>}
            <button type="button" className="btn dialog-cancel" disabled={Boolean(deletingMode)} onClick={closeDeleteDialog}>取消</button>
          </section>
        </div>
      )}
    </>
  );
}
