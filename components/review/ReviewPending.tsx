"use client";
import Link from "next/link";
import NextImage from "next/image";
import { ArrowLeft, Check, FileText, Plus, RefreshCw } from "lucide-react";
import type { ReviewDocument, ReviewPage } from "../../lib/types";
import type { useReviewProgress } from "./useReviewProgress";
type Progress = ReturnType<typeof useReviewProgress>;
export function ReviewPending({ sourceDocument, currentPageInfo, recognition, job, recognitionPhaseLabel, retrying, retryExtraction, addManualQuestion, saveError, processorAvailable, preparePages }: {
 sourceDocument: ReviewDocument; currentPageInfo?: ReviewPage; recognition: Progress["recognition"]; job: Progress["job"];
 recognitionPhaseLabel: string; retrying: boolean; retryExtraction: () => Promise<void>; addManualQuestion: (page: number) => Promise<void>; saveError: string; processorAvailable: boolean; preparePages: () => Promise<void>;
}) {
    return (
      <div className="page-shell">
        <Link href="/" className="btn"><ArrowLeft size={16} /> 返回</Link>
        <section className="card extraction-empty">
          {currentPageInfo && <div className="empty-page-preview"><NextImage src={currentPageInfo.imageUrl} alt="原始试卷首页" width={currentPageInfo.width} height={currentPageInfo.height} unoptimized priority /></div>}
          <div className="empty-progress-panel">
            <h1>{sourceDocument.name}</h1>
            <p>{!currentPageInfo
              ? sourceDocument.status === "uploading"
                ? "原卷正在上传并生成分页图，页面准备好后会自动显示。"
                : "原卷分页图尚未保存，请返回工作台重新上传同一 PDF 补齐页面，现有识别结果会保留。"
              : sourceDocument.status === "awaiting_model" ? "原卷和分页图已保存，请先配置识题模型，再点击下方按钮开始识别。"
              : "整份试卷只调用一次模型。模型确认总题数后逐题流式返回，后端每收到一题就立即校验并保存。"}</p>
            <div className="question-stream-heading">
              <strong>{!currentPageInfo ? "等待原卷页面" : sourceDocument.status === "awaiting_model" ? "等待配置模型" : recognition.questionTotal
                ? `已完成 ${recognition.completedQuestionCount} / ${recognition.questionTotal} 题`
                : "正在统计整卷题目总数"}</strong>
              <span>{!currentPageInfo ? sourceDocument.status === "uploading" ? "正在准备页面" : "需要补齐页面" : sourceDocument.status === "awaiting_model" ? "页面已保存" : recognitionPhaseLabel}</span>
            </div>
            <div className="question-stream-bar" role="progressbar" aria-valuemin={0} aria-valuemax={recognition.questionTotal ?? undefined} aria-valuenow={recognition.completedQuestionCount}>
              <span style={{ width: `${recognition.percent}%` }} />
            </div>
            <div className="question-stream-status">
              {recognition.completedQuestionNumbers.length
                ? recognition.completedQuestionNumbers.map((number) => <span key={number}><Check size={13} /> 第 {number} 题</span>)
                : <em>{!currentPageInfo ? "分页图准备好后才能识别和审核。" : sourceDocument.status === "awaiting_model" ? "配置模型后即可开始整卷识别。" : recognition.message ?? "模型正在通读全部页面，题目完成后会逐个显示在这里。"}</em>}
            </div>
            {currentPageInfo && <p className="stream-timeout-note">模型持续输出文字或思考活动时会一直处理；只有连续 90 秒没有任何活动，或模型明确报错，才会进入退避重试。</p>}
            {job.status === "retry_wait" && job.nextAttemptAt && <p className="queue-notice">网络退避中，将在 {new Date(job.nextAttemptAt).toLocaleString()} 自动继续。</p>}
            {job.status === "paused" && <p className="queue-notice">全部识别任务已暂停。请在工作台点击“全部开始”，未完成试卷会立即重新排队。</p>}
            {(job.lastError || sourceDocument.error) && <p className="form-error">{job.lastError || sourceDocument.error}</p>}
            <div className="header-actions">
              <Link href={`/review/${sourceDocument.id}/logs`} className="btn"><FileText size={15} /> 查看识别日志</Link>
              {sourceDocument.status === "awaiting_model" && <Link href="/settings/models" className="btn">配置识题模型</Link>}
              <button type="button" className="btn btn-primary" disabled={!currentPageInfo || retrying || ["queued", "processing"].includes(job.status ?? "")} onClick={() => void retryExtraction()}><RefreshCw size={15} /> {retrying ? "正在加入队列…" : ["queued", "processing", "retry_wait"].includes(job.status ?? "") ? "可靠队列处理中" : "重新识别整卷"}</button>
              {!currentPageInfo && processorAvailable && <button type="button" className="btn" disabled={retrying} onClick={() => void preparePages()}>重新生成分页图</button>}
              {currentPageInfo && <button type="button" className="btn" onClick={() => void addManualQuestion(currentPageInfo.pageNumber)}><Plus size={15} /> 手动补一道题</button>}
            </div>
            {saveError && <p className="form-error">{saveError}</p>}
          </div>
        </section>
      </div>
    );
}
