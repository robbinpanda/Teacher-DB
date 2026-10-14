"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, Check, FileStack, FileX2, ListChecks, LoaderCircle, Pause, Play, ScanText, Search, Trash2, X } from "lucide-react";
import type { DocumentListResult } from "../lib/document-list";
import type { SourceDocument } from "../lib/types";
import type { ExtractionSpeed } from "../lib/extraction-speed";
import { documentGroup, documentGroups as groupMeta, type DocumentGroup, type DocumentSort } from "../lib/workbench-documents";
import { DocumentTable } from "./DocumentTable";
import { WorkbenchOverview } from "./WorkbenchOverview";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { UploadWorkbench } from "./UploadWorkbench";
import { AutomaticAiReviewToggle } from "./AutomaticAiReviewToggle";

type QueueControlState = {
  automaticAiReviewEnabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  pausedCount: number;
  activeCount: number;
  queuedCount: number;
  speed?: ExtractionSpeed;
};

export function Workbench({ initialPage, importOpen = false }: { importOpen?: boolean; initialPage: DocumentListResult }) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialPage.documents);
  const [metadata, setMetadata] = useState(initialPage);
  const [page, setPage] = useState(1);
  const [activeGroup, setActiveGroup] = useState<DocumentGroup>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DocumentSort>("newest");
  const [refreshing, setRefreshing] = useState(true);
  const [target, setTarget] = useState<SourceDocument | null>(null);
  const [deletingMode, setDeletingMode] = useState<"with_questions" | "source_only" | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchAction, setBatchAction] = useState<"approve" | "approve_all" | null>(null);
  const approvingRef = useRef(false);
  const listVersionRef = useRef(0);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const [batchWarning, setBatchWarning] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [queueState, setQueueState] = useState<QueueControlState>({ automaticAiReviewEnabled: false, paused: false, pauseReason: null, pausedCount: 0, activeCount: 0, queuedCount: 0 });
  const [queueBusy, setQueueBusy] = useState(false);
  const [speed, setSpeed] = useState<ExtractionSpeed>();

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/extraction-queue?summary=1", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) throw new Error("速度监控暂不可用");
        const result = await response.json() as Partial<QueueControlState>;
        if (!cancelled) setSpeed(result.speed);
      } catch {
        if (!cancelled) setSpeed(undefined);
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden || approvingRef.current || inFlight) return;
      inFlight = true;
      const version = listVersionRef.current;
      try {
        const [response, queueResponse] = await Promise.all([
          fetch(`/api/documents?${new URLSearchParams({ page: String(page), pageSize: "50", group: activeGroup, search, sort })}`, { cache: "no-store", signal: controller.signal }),
          fetch("/api/extraction-queue?summary=1", { cache: "no-store", signal: controller.signal }),
        ]);
        const result = await response.json().catch(() => ({})) as DocumentListResult & { error?: string };
        const queue = await queueResponse.json().catch(() => ({})) as Partial<QueueControlState> & { error?: string };
        if (!response.ok || !result.documents) throw new Error(result.error ?? "无法更新试卷状态");
        if (!queueResponse.ok) throw new Error(queue.error ?? "无法更新识别队列状态");
        if (!cancelled && version === listVersionRef.current) {
          setDocuments(result.documents);
          setMetadata(result);
          if (result.pagination.page !== page) setPage(result.pagination.page);
          setQueueState({
            automaticAiReviewEnabled: queue.automaticAiReviewEnabled === true,
            paused: Boolean(queue.paused),
            pauseReason: queue.pauseReason ?? null,
            pausedCount: Number(queue.pausedCount ?? 0),
            activeCount: Number(queue.activeCount ?? 0),
            queuedCount: Number(queue.queuedCount ?? 0),
            speed: queue.speed,
          });
          const currentIds = new Set(result.documents.map((item) => item.id));
          setSelectedIds((ids) => new Set(Array.from(ids).filter((id) => currentIds.has(id))));
          setListError("");
        }
      } catch (caught) {
        if (!cancelled && version === listVersionRef.current) setListError(caught instanceof Error ? caught.message : "无法更新试卷状态");
      } finally { inFlight = false; if (!cancelled) setRefreshing(false); }
    };
    const firstRefresh = window.setTimeout(() => void refresh(), 200);
    const timer = window.setInterval(() => void refresh(), 5000);
    const onVisibilityChange = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(firstRefresh);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [initialPage, page, activeGroup, search, sort]);

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
        if (action === "pause" && item.jobStatus && item.jobStatus !== "processing") {
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

  async function approveDocuments(allPending = false) {
    const documentIds = documents.filter(document => selectedIds.has(document.id) && documentGroup(document) === "pending_review").map(document => document.id);
    if (approvingRef.current || (!allPending && !documentIds.length)) return;
    approvingRef.current = true;
    listVersionRef.current += 1;
    setBatchAction(allPending ? "approve_all" : "approve");
    setListError("");
    setBatchNotice("");
    setBatchWarning("");
    try {
      const response = await fetch("/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(allPending ? { action: "approve_all_without_review" } : { action: "approve_without_review", documentIds }),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        changed?: number;
        completedDocuments?: number;
        reviewRequired?: number;
        documents?: Array<{ id: string; status: "reviewing" | "complete"; total: number; approved: number }>;
        skippedDocuments?: Array<{ id: string; name: string; reason: string }>;
      };
      if (!response.ok || !result.documents) throw new Error(result.error ?? "批量完成失败");
      const updates = new Map(result.documents.map((document) => [document.id, document]));
      setDocuments((items) => items.map((item) => {
        const update = updates.get(item.id);
        return update ? { ...item, status: update.status, questionCount: update.total, approvedCount: update.approved } : item;
      }));
      setBatchNotice(`已自动入库 ${result.changed ?? 0} 道无需人工核查的题目；${result.completedDocuments ?? 0} 份试卷已全部完成${result.reviewRequired ? `，仍有 ${result.reviewRequired} 道需人工复核` : ""}。`);
      const skipped = result.skippedDocuments ?? [];
      if (skipped.length) setBatchWarning(`${skipped.length} 份试卷暂未入库：${skipped.map(document => `《${document.name}》${document.reason}`).join("；")}`);
      if (allPending && (result.completedDocuments ?? 0) > 0 && result.documents.every(document => document.status === "complete") && !skipped.length) setActiveGroup("reviewed");
      setSelectedIds(new Set());
      setSelectionMode(false);
      router.refresh();
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "批量完成失败");
    } finally {
      listVersionRef.current += 1;
      approvingRef.current = false;
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
    selectGroup(groupMeta[nextIndex].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIndex]?.focus();
  }

  const groupCounts = metadata.counts;
  const activeGroupMeta = groupMeta.find((group) => group.id === activeGroup) ?? groupMeta[0];
  const activeDocuments = documents;
  const allActiveSelected = activeDocuments.length > 0 && activeDocuments.every((document) => selectedIds.has(document.id));
  const selectedDocuments = documents.filter((document) => selectedIds.has(document.id));

  function closeDeleteDialog() {
    if (deletingMode) return;
    setTarget(null);
    setBatchDeleteOpen(false);
    setError("");
  }

  function selectGroup(group: DocumentGroup) {
    if (batchAction || deletingMode) return;
    setActiveGroup(group);
    setPage(1);
    setRefreshing(true);
    setSelectedIds(new Set());
    setSelectionMode(false);
    setSearch("");
  }
  const nextReview = documents.find(document => document.status === "reviewing" && document.approvedCount < document.questionCount)
    ?? documents.find(document => document.status === "reviewing");
  const busy = Boolean(batchAction || deletingMode);

  return <div className="workbench">
    <header className="wb-header">
      <div><h1>工作台</h1><p>管理试卷、审核题目并沉淀至题库</p></div>
      <div className="wb-header-actions">
        <AutomaticAiReviewToggle />
        <Link className="wb-button wb-quiet" href="/bank"><FileStack size={16} />打开题库</Link>
        {nextReview && <Link className="wb-button" href={`/review/${nextReview.id}`}><ScanText size={16} />继续审核</Link>}
        <UploadWorkbench initiallyOpen={importOpen} />
      </div>
    </header>
    <WorkbenchOverview stats={metadata.stats} speed={speed} onSelect={selectGroup} />
    <section className="wb-library" aria-labelledby="papers-heading">
      <div className="wb-library-heading"><h2 id="papers-heading">试卷管理 <span>{metadata.counts.all.toLocaleString("zh-CN")} 份</span></h2>{refreshing && <span className="wb-sync"><LoaderCircle size={13} className="spin" />同步中</span>}</div>
      <div className="wb-toolbar">
        <div className="wb-tabs" role="tablist" aria-label="试卷处理状态">
          {groupMeta.map((group, index) => <button type="button" role="tab" id={`document-tab-${group.id}`} aria-controls="document-status-panel" aria-selected={activeGroup === group.id} tabIndex={activeGroup === group.id ? 0 : -1} key={group.id} disabled={busy} onClick={() => selectGroup(group.id)} onKeyDown={event => moveGroupFocus(event, index)} title={group.description}>{group.title}<b>{groupCounts[group.id]}</b></button>)}
        </div>
        <div className="wb-tools">
          <label className="wb-search"><Search size={15} /><input type="search" aria-label="搜索试卷名称" placeholder="搜索试卷名称" value={search} disabled={busy} onChange={event => { setSearch(event.target.value); setPage(1); setSelectedIds(new Set()); }} /></label>
          <select className="wb-sort" aria-label="试卷排序" value={sort} onChange={event => { setSort(event.target.value as DocumentSort); setPage(1); setSelectedIds(new Set()); }}><option value="newest">上传时间：最新</option><option value="oldest">上传时间：最早</option><option value="name">试卷名称</option></select>
          {activeDocuments.length > 0 && <button className="wb-button" type="button" disabled={busy} onClick={() => { setSelectionMode(true); setSelectedIds(allActiveSelected ? new Set() : new Set(activeDocuments.map(document => document.id))); setBatchNotice(""); }}>{allActiveSelected ? "取消本页全选" : "全选本页"}</button>}
          {!selectionMode && activeDocuments.length > 0 && <button className="wb-button" type="button" disabled={busy} onClick={() => { setSelectionMode(true); setBatchNotice(""); }}><ListChecks size={15} />批量操作</button>}
        </div>
      </div>
      <section id="document-status-panel" role="tabpanel" aria-labelledby={`document-tab-${activeGroup}`}>
        {(selectionMode || (activeGroup === "pending_review" && !search.trim() && activeDocuments.length > 0) || (activeGroup === "preprocessing" && activeDocuments.length > 0)) && <div className="wb-bulkbar">
          {selectionMode ? <>
            <span>已选 {selectedIds.size} 份</span>
            <div className="wb-bulk-actions">
              {selectedDocuments.some(document => documentGroup(document) === "pending_review") && <button className="wb-button" type="button" disabled={busy} onClick={() => void approveDocuments()}><Check size={14} />{batchAction === "approve" ? "入库中…" : "完成并自动入库"}</button>}
              <button className="wb-button wb-danger-text" type="button" disabled={!selectedIds.size || busy} onClick={() => { setBatchDeleteOpen(true); setError(""); }}>批量删除</button>
              <button className="wb-text-button" type="button" disabled={busy} onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}>取消</button>
            </div>
          </> : <>
            <span>{activeGroup === "pending_review" ? queueState.automaticAiReviewEnabled ? "仅自动入库无需人工核查的题目" : "AI 复核已关闭，全部题目可一键入库" : queueState.paused ? "识别队列已暂停" : "后台识别队列"}</span>
            {activeGroup === "pending_review" && <button className="wb-button" type="button" disabled={busy} onClick={() => void approveDocuments(true)}>{batchAction === "approve_all" ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{batchAction === "approve_all" ? "全部入库中…" : "一键全部入库"}</button>}
            {activeGroup === "preprocessing" && <button className="wb-button" type="button" disabled={queueBusy} onClick={() => void controlQueue(queueState.paused ? "resume" : "pause")}>{queueBusy ? <LoaderCircle size={14} className="spin" /> : queueState.paused ? <Play size={14} /> : <Pause size={14} />}{queueState.paused ? "全部开始" : "全部暂停"}</button>}
          </>}
        </div>}
        {listError && <p className="wb-notice wb-error" role="alert"><AlertTriangle size={15} />{listError}</p>}
        {queueState.paused && activeGroup === "preprocessing" && <p className="wb-notice" role="status"><Pause size={15} />{queueState.pauseReason ?? "全部识别已暂停，点击“全部开始”继续。"}</p>}
        {batchNotice && <p className="wb-notice document-bulk-notice" role="status"><Check size={15} />{batchNotice}</p>}
        {batchWarning && <p className="wb-notice wb-error document-bulk-warning" role="alert"><AlertTriangle size={15} />{batchWarning}</p>}
        {activeDocuments.length ? <DocumentTable documents={activeDocuments} selectionMode={selectionMode} selectedIds={selectedIds} retryingIds={retryingIds} busy={busy} onToggle={toggleDocument} onDelete={document => { setTarget(document); setError(""); }} onRetry={document => void retryDocument(document)} /> :
          <div className="wb-empty document-group-empty"><FileStack size={28} /><h3>{search.trim() ? "没有匹配的试卷" : activeGroupMeta.empty}</h3><p>{search.trim() ? "试试其他名称，或清除搜索条件。" : documents.length ? "可切换其他状态查看试卷。" : "支持批量上传 PDF，识别完成后即可审核。"}</p>{search.trim() && <button type="button" className="wb-button" onClick={() => setSearch("")}>清除搜索</button>}</div>}
        <form className="wb-pagination" aria-label="试卷分页" onSubmit={event => {
          event.preventDefault();
          const value = Number(new FormData(event.currentTarget).get("page"));
          if (Number.isInteger(value) && value > 0) { setPage(Math.min(value, metadata.pagination.totalPages)); setSelectedIds(new Set()); }
        }}>
          <span>共 {metadata.pagination.total.toLocaleString("zh-CN")} 份 · 每页 {metadata.pagination.pageSize} 份</span>
          <button type="button" className="wb-button" disabled={busy || page <= 1} onClick={() => { setPage(page - 1); setSelectedIds(new Set()); }}>上一页</button>
          <span>第 {metadata.pagination.page} / {metadata.pagination.totalPages} 页</span>
          <button type="button" className="wb-button" disabled={busy || page >= metadata.pagination.totalPages} onClick={() => { setPage(page + 1); setSelectedIds(new Set()); }}>下一页</button>
          <label>跳至 <input key={metadata.pagination.page} aria-label="跳转页码" name="page" type="number" min="1" max={metadata.pagination.totalPages} defaultValue={metadata.pagination.page} /></label>
          <button className="wb-button" disabled={busy} type="submit">跳转</button>
        </form>
      </section>
    </section>
    <WorkbenchDialog open={Boolean(target || batchDeleteOpen)} titleId="delete-document-title" busy={Boolean(deletingMode)} onClose={closeDeleteDialog}>
      <header className="wb-dialog-header"><h2 id="delete-document-title">{target ? "删除试卷" : `批量删除 ${selectedDocuments.length} 份试卷`}</h2><button type="button" className="wb-icon-button" aria-label="关闭" disabled={Boolean(deletingMode)} onClick={closeDeleteDialog}><X size={18} /></button></header>
      <div className="wb-dialog-body"><p className="wb-delete-name">{target ? target.name : selectedDocuments.slice(0, 3).map(document => document.name).join("、") + (selectedDocuments.length > 3 ? ` 等 ${selectedDocuments.length} 份` : "")}</p>
        <div className="wb-delete-choices">
          <button type="button" disabled={Boolean(deletingMode)} onClick={() => void (target ? removeDocument("with_questions") : removeSelectedDocuments("with_questions"))}><Trash2 size={18} /><span><strong>{deletingMode === "with_questions" ? "正在彻底删除…" : "同步删除试卷和题目"}</strong><small>删除原文件、页面图、全部题目和题图；相关组卷引用也会移除。</small></span></button>
          <button type="button" disabled={Boolean(deletingMode)} onClick={() => void (target ? removeDocument("source_only") : removeSelectedDocuments("source_only"))}><FileX2 size={18} /><span><strong>{deletingMode === "source_only" ? "正在删除试卷来源…" : "只删除试卷，保留已入库题目"}</strong><small>保留已入库题目；删除原页面后将无法预览、修改或重新识别。</small></span></button>
        </div>
        <p className="wb-notice wb-error"><AlertTriangle size={15} />删除不可恢复。仅保留题目时，也会永久失去原卷编辑能力。</p>
        {error && <p className="wb-notice wb-error" role="alert">{error}</p>}
      </div>
      <footer className="wb-dialog-footer"><button className="wb-button" type="button" disabled={Boolean(deletingMode)} onClick={closeDeleteDialog}>取消</button></footer>
    </WorkbenchDialog>
  </div>;
}
