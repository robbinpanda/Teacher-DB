"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Clock3, FileX2, Trash2, X } from "lucide-react";
import type { SourceDocument } from "../lib/types";

export function RecentDocuments({ initialDocuments }: { initialDocuments: SourceDocument[] }) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [target, setTarget] = useState<SourceDocument | null>(null);
  const [deletingMode, setDeletingMode] = useState<"with_questions" | "source_only" | null>(null);
  const [error, setError] = useState("");

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

  return (
    <>
      <div className="document-list">
        {documents.map((doc) => {
          const recognitionProgress = doc.pageCount ? Math.round(doc.completedPageCount / doc.pageCount * 100) : 0;
          const progress = doc.status === "reviewing" || doc.status === "complete"
            ? (doc.questionCount ? Math.round(doc.approvedCount / doc.questionCount * 100) : 100)
            : recognitionProgress;
          const queueLabel = doc.jobStatus === "retry_wait"
            ? `网络退避 · 已保存 ${doc.completedPageCount}/${doc.pageCount} 页`
            : doc.jobStatus === "queued"
              ? `队列等待 · 已保存 ${doc.completedPageCount}/${doc.pageCount} 页`
              : doc.jobStatus === "processing"
                ? `AI 识别 · 已保存 ${doc.completedPageCount}/${doc.pageCount} 页`
                : null;
          const href = doc.status === "complete" ? "/bank" : doc.status === "uploading" ? "/" : `/review/${doc.id}`;
          return (
            <div className="document-row-wrap" key={doc.id}>
              <Link href={href} className="document-row card">
                <span className={`document-icon ${doc.subject}`}>{doc.subject.slice(0, 1)}</span>
                <div className="document-main"><strong>{doc.name}</strong><span><Clock3 size={12} /> {new Date(doc.createdAt).toLocaleString("zh-CN")} · {doc.pageCount} 页 · {doc.grade}</span></div>
                <div className="document-progress"><div><span>{queueLabel ?? (doc.status === "uploading" ? "原卷预处理中" : doc.status === "extracting" ? `等待识别 · ${doc.completedPageCount}/${doc.pageCount} 页` : doc.status === "failed" ? `处理失败 · 已保存 ${doc.completedPageCount}/${doc.pageCount} 页` : doc.status === "complete" ? "已入库" : `已审核 ${doc.approvedCount}/${doc.questionCount}`)}</span><b>{progress}%</b></div><div className="progress"><span style={{ width: `${progress}%` }} /></div></div>
                <ArrowRight size={17} className="row-arrow" />
              </Link>
              <button type="button" className="document-delete" title="删除试卷" aria-label={`删除 ${doc.name}`} onClick={() => { setTarget(doc); setError(""); }}><Trash2 size={15} /></button>
            </div>
          );
        })}
        {!documents.length && <div className="card empty-state"><h3>还没有处理记录</h3><p>在上方上传第一份 PDF 试卷。</p></div>}
      </div>

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
