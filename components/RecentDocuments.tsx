"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, Clock3, FileX2, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import type { SourceDocument } from "../lib/types";

type DocumentGroup = "preprocessing" | "pending_review" | "reviewed";

const groupMeta: Array<{ id: DocumentGroup; title: string; description: string; empty: string }> = [
  { id: "preprocessing", title: "AI 预处理中", description: "上传、排队、识别、退避或暂停中的试卷", empty: "暂无正在处理的试卷" },
  { id: "pending_review", title: "待审核", description: "AI 已完成识别，等待人工逐题确认", empty: "暂无待审核试卷" },
  { id: "reviewed", title: "已人工审核", description: "全部题目已经人工确认并入库", empty: "暂无已审核试卷" },
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
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/documents", { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { documents?: SourceDocument[]; error?: string };
        if (!response.ok || !result.documents) throw new Error(result.error ?? "无法更新试卷状态");
        if (!cancelled) {
          setDocuments(result.documents);
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
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIndex]?.focus();
  }

  function renderDocument(doc: SourceDocument) {
    const recognitionProgress = doc.pageCount ? Math.round(doc.completedPageCount / doc.pageCount * 100) : 0;
    const reviewed = documentGroup(doc) === "reviewed";
    const progress = doc.status === "reviewing" || reviewed
      ? (doc.questionCount ? Math.round(doc.approvedCount / doc.questionCount * 100) : 0)
      : recognitionProgress;
    const retrying = retryingIds.has(doc.id);
    const paused = doc.jobStatus === "failed";
    const queueLabel = paused
      ? `已暂停 · 连续失败 ${doc.jobAttempt ?? 8} 次`
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
            ? `已人工审核 ${doc.approvedCount}/${doc.questionCount}`
            : `待审核 · 已确认 ${doc.approvedCount}/${doc.questionCount}`);
    const href = doc.status === "uploading" ? "/" : `/review/${doc.id}`;
    return (
      <div className={`document-row-wrap ${paused ? "paused" : ""}`} key={doc.id}>
        <Link href={href} className="document-row card">
          <span className={`document-icon ${doc.subject}`}>{doc.subject.slice(0, 1)}</span>
          <div className="document-main"><strong>{doc.name}</strong><span><Clock3 size={12} /> {new Date(doc.createdAt).toLocaleString("zh-CN")} · {doc.pageCount} 页 · {doc.grade}</span></div>
          <div className="document-progress" title={doc.lastError ?? undefined}><div><span>{statusLabel}</span><b>{progress}%</b></div><div className="progress"><span style={{ width: `${progress}%` }} /></div></div>
          <ArrowRight size={17} className="row-arrow" />
        </Link>
        <div className="document-actions">
          {paused && <button type="button" className="document-retry" disabled={retrying} title="重新识别未完成页面" aria-label={`重试 ${doc.name}`} onClick={() => void retryDocument(doc)}>{retrying ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button>}
          <button type="button" className="document-delete" title="删除试卷" aria-label={`删除 ${doc.name}`} onClick={() => { setTarget(doc); setError(""); }}><Trash2 size={15} /></button>
        </div>
      </div>
    );
  }

  const groupCounts = Object.fromEntries(groupMeta.map((group) => [
    group.id,
    documents.filter((document) => documentGroup(document) === group.id).length,
  ])) as Record<DocumentGroup, number>;
  const activeGroupMeta = groupMeta.find((group) => group.id === activeGroup) ?? groupMeta[0];
  const activeDocuments = documents.filter((document) => documentGroup(document) === activeGroup);

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
            onClick={() => setActiveGroup(group.id)}
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
        <div className="document-view-summary"><p>{activeGroupMeta.description}</p><span>共 {activeDocuments.length} 份</span></div>
        <div className="document-list">
          {activeDocuments.map(renderDocument)}
          {!activeDocuments.length && <div className="document-group-empty">{documents.length ? activeGroupMeta.empty : "还没有处理记录，请在上方上传第一份 PDF 试卷。"}</div>}
        </div>
      </section>

      {target && (
        <div className="delete-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingMode) setTarget(null); }}>
          <section className="delete-dialog card" role="dialog" aria-modal="true" aria-labelledby="delete-document-title">
            <button type="button" className="dialog-close" aria-label="关闭" disabled={Boolean(deletingMode)} onClick={() => setTarget(null)}><X size={16} /></button>
            <span className="dialog-icon"><FileX2 size={20} /></span>
            <h2 id="delete-document-title">删除试卷</h2>
            <p className="delete-document-name">{target.name}</p>
            <div className="delete-choice-list">
              <button type="button" disabled={Boolean(deletingMode)} onClick={() => void removeDocument("with_questions")}>
                <Trash2 size={17} /><span><strong>{deletingMode === "with_questions" ? "正在彻底删除…" : "同步删除试卷和题目"}</strong><small>删除原文件、页面图、全部题目和题图；相关组卷引用也会移除。</small></span>
              </button>
              <button type="button" disabled={Boolean(deletingMode)} onClick={() => void removeDocument("source_only")}>
                <FileX2 size={17} /><span><strong>{deletingMode === "source_only" ? "正在删除试卷来源…" : "只删除试卷，保留已入库题目"}</strong><small>题库中的已入库题目继续保留，但原页面被删除后将无法预览、修改或重新识别。</small></span>
              </button>
            </div>
            <p className="delete-warning"><AlertTriangle size={14} /> 只删除试卷是不可逆操作，保留题目将永久失去原卷编辑能力。</p>
            {error && <p className="form-error">{error}</p>}
            <button type="button" className="btn dialog-cancel" disabled={Boolean(deletingMode)} onClick={() => setTarget(null)}>取消</button>
          </section>
        </div>
      )}
    </>
  );
}
