import Link from "next/link";
import { FileText, LoaderCircle } from "lucide-react";
import type { SourceDocument } from "../lib/types";
import { documentGroup } from "../lib/workbench-documents";

function processingLabel(doc: SourceDocument) {
  if (doc.jobStatus === "paused") return "识别已暂停";
  if (doc.jobStatus === "failed" || doc.status === "failed") return "处理异常";
  if (doc.jobStatus === "retry_wait") return "等待重试";
  if (doc.jobStatus === "queued") return "排队中";
  if (doc.status === "awaiting_model") return "等待配置模型";
  if (doc.status === "uploading") return "准备页面中";
  return "识别中";
}

export function DocumentTable({ documents, selectionMode, selectedIds, retryingIds, busy, onToggle, onDelete, onRetry }: {
  documents: SourceDocument[]; selectionMode: boolean; selectedIds: Set<string>; retryingIds: Set<string>; busy: boolean;
  onToggle: (id: string) => void; onDelete: (document: SourceDocument) => void; onRetry: (document: SourceDocument) => void;
}) {
  return <div className="wb-table-scroll" tabIndex={0} role="region" aria-label="试卷表格，可横向滚动">
    <table className="wb-table">
      <caption className="wb-sr-only">试卷管理列表</caption>
      <colgroup><col className="wb-name-col" /><col className="wb-scope-col" /><col className="wb-count-col" /><col className="wb-progress-col" /><col className="wb-date-col" /><col className="wb-actions-col" /></colgroup>
      <thead><tr><th scope="col">试卷名称</th><th scope="col">年级 / 学科</th><th scope="col">题目数量</th><th scope="col">审核进度</th><th scope="col">上传时间</th><th scope="col">操作</th></tr></thead>
      <tbody>{documents.map(doc => {
        const group = documentGroup(doc);
        const processing = group === "preprocessing";
        const failed = doc.status === "failed" || doc.jobStatus === "failed";
        const status = processing ? processingLabel(doc) : group === "reviewed" ? "已入库" : "待审核";
        const progress = doc.questionCount ? Math.min(100, Math.round(doc.approvedCount / doc.questionCount * 100)) : 0;
        const model = doc.modelDisplayName ?? doc.modelName;
        const href = `/review/${doc.id}`;
        return <tr key={doc.id} className={selectedIds.has(doc.id) ? "selected" : undefined}>
          <td><div className="wb-document-name">
            {selectionMode ? <label className="document-selector"><input type="checkbox" aria-label={`选择 ${doc.name}`} disabled={busy} checked={selectedIds.has(doc.id)} onChange={() => onToggle(doc.id)} /></label> : <FileText size={18} aria-hidden="true" />}
            <div className="document-main"><Link href={href}><strong title={doc.name}>{doc.name}</strong></Link><span><em className={`wb-status ${failed ? "failed" : group}`}>{status}</em><span title={model ? `识别模型：${model}` : undefined}>{doc.pageCount} 页{model ? ` · ${model}` : ""}</span></span></div>
          </div></td>
          <td><span className="wb-cell-primary">{doc.grade || "未设置年级"}</span><span className="wb-cell-secondary">{doc.subject}</span></td>
          <td>{processing && !doc.questionCount ? <span className="wb-muted">—</span> : doc.questionCount}</td>
          <td>{processing ? <div className={`wb-processing${failed ? " failed" : ""}`} title={doc.lastError ?? doc.recognitionMessage ?? undefined}>
            <span>{status}</span><small>{doc.recognitionQuestionTotal ? `已识别 ${doc.recognizedQuestionCount ?? 0}/${doc.recognitionQuestionTotal} 题` : doc.nextAttemptAt ? `${new Date(doc.nextAttemptAt).toLocaleTimeString("zh-CN")} 重试` : doc.status === "uploading" ? "原卷正在准备" : "尚未进入审核"}</small>
          </div> : <div className="wb-review-progress"><span>{doc.approvedCount}<span> / {doc.questionCount} 题</span></span><div role="progressbar" aria-label={`${doc.name} 审核进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div></div>}</td>
          <td><time dateTime={doc.createdAt} title={new Date(doc.createdAt).toLocaleString("zh-CN")}><span className="wb-cell-primary">{new Date(doc.createdAt).toLocaleDateString("zh-CN")}</span><span className="wb-cell-secondary">{new Date(doc.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span></time></td>
          <td><div className="wb-row-actions"><Link href={href}>{group === "pending_review" ? "审核" : "查看"}</Link><Link href={`/review/${doc.id}/logs`} className="wb-muted" aria-label={`识别日志 ${doc.name}`}>日志</Link><button type="button" className="wb-danger-text" disabled={busy} aria-label={`删除 ${doc.name}`} onClick={() => onDelete(doc)}>删除</button>
            {doc.jobStatus === "failed" && <button type="button" disabled={busy || retryingIds.has(doc.id)} aria-label={`重试 ${doc.name}`} title={doc.completedPageCount >= doc.pageCount ? "重新执行收尾校验" : "重新识别整份试卷"} onClick={() => onRetry(doc)}>{retryingIds.has(doc.id) ? <LoaderCircle size={12} className="spin" /> : "重试"}</button>}
          </div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
