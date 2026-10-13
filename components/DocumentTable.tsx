import Link from "next/link";
import { FileText, LoaderCircle } from "lucide-react";
import type { SourceDocument } from "../lib/types";
import { documentGroup } from "../lib/workbench-documents";
import { DocumentModelLogsButton } from "./review/DocumentModelLogsButton";

function processingLabel(doc: SourceDocument) {
  if (doc.jobStatus === "paused") return "识别已暂停";
  if (doc.jobStatus === "failed" || doc.status === "failed") return "处理异常";
  if (doc.jobStatus === "retry_wait") return "等待重试";
  if (doc.jobStatus === "queued") return "排队中";
  if (doc.status === "awaiting_model") return "等待配置模型";
  if (doc.status === "uploading") return "准备页面中";
  if (!doc.jobStatus && doc.status === "extracting") return "尚未进入队列";
  return "识别中";
}

function RecognitionProgress({ document: doc }: { document: SourceDocument }) {
  const total = doc.recognitionQuestionTotal && doc.recognitionQuestionTotal > 0 ? doc.recognitionQuestionTotal : null;
  const failedReviews = doc.aiReviewFailedQuestionCount ?? 0;
  return <div className="wb-recognition-progress" title={[doc.lastError, doc.recognitionMessage, failedReviews ? `${failedReviews} 题 AI 复核失败，需重试` : ""].filter(Boolean).join("；")}>
    {[{ label: "识别", count: doc.recognizedQuestionCount ?? 0 }, ...(doc.aiReviewEnabled ? [{ label: "AI复核", count: doc.aiReviewedQuestionCount ?? 0 }] : [])].map(({ label, count }) => {
      const percent = total ? Math.min(100, Math.round(count / total * 100)) : undefined;
      return <div className="wb-mini-progress" key={label}>
        <span><small>{label}</small><small>{count}/{total ?? "?"}</small></span>
        <div role="progressbar" aria-label={`${doc.name} ${label}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          aria-valuetext={`${count}/${total ?? "待确认"} 题${label === "AI复核" && failedReviews ? `，${failedReviews} 题复核失败` : ""}`}>
          <i style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>;
    })}
    {!doc.aiReviewEnabled && <small>AI 复核已关闭</small>}
  </div>;
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
          <td>{processing && (doc.jobStatus === "processing" || doc.recognitionQuestionTotal || doc.recognizedQuestionCount) ? <RecognitionProgress document={doc} /> : processing ? <div className={`wb-processing${failed ? " failed" : ""}`} title={doc.lastError ?? doc.recognitionMessage ?? undefined}>
            <span>{status}</span><small>{doc.recognitionQuestionTotal ? `已识别 ${doc.recognizedQuestionCount ?? 0}/${doc.recognitionQuestionTotal} 题` : doc.nextAttemptAt ? `${new Date(doc.nextAttemptAt).toLocaleTimeString("zh-CN")} 重试` : doc.status === "uploading" ? "原卷正在准备" : "尚未进入审核"}</small>
          </div> : <div className="wb-review-progress"><span>{doc.approvedCount}<span> / {doc.questionCount} 题</span></span><div role="progressbar" aria-label={`${doc.name} 审核进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div></div>}</td>
          <td><time dateTime={doc.createdAt} title={new Date(doc.createdAt).toLocaleString("zh-CN")}><span className="wb-cell-primary">{new Date(doc.createdAt).toLocaleDateString("zh-CN")}</span><span className="wb-cell-secondary">{new Date(doc.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span></time></td>
          <td><div className="wb-row-actions"><Link href={href}>{group === "pending_review" ? "审核" : "查看"}</Link><DocumentModelLogsButton documentId={doc.id} documentName={doc.name} documentError={doc.lastError} className="wb-muted" label="日志" showIcon={false} /><button type="button" className="wb-danger-text" disabled={busy} aria-label={`删除 ${doc.name}`} onClick={() => onDelete(doc)}>删除</button>
            {(doc.jobStatus === "failed" || (!doc.jobStatus && ["awaiting_model", "extracting"].includes(doc.status))) && <button type="button" disabled={busy || retryingIds.has(doc.id)} aria-label={`${doc.jobStatus ? "重试" : "开始识别"} ${doc.name}`} title={doc.completedPageCount >= doc.pageCount ? "重新执行收尾校验" : "使用当前选中的模型识别整份试卷"} onClick={() => onRetry(doc)}>{retryingIds.has(doc.id) ? <LoaderCircle size={12} className="spin" /> : doc.jobStatus ? "重试" : "开始识别"}</button>}
          </div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
