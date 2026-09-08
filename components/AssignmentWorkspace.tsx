"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CheckCircle2, ClipboardPen, FilePlus2, Lock, Printer, RotateCcw, Save, Tag, Users } from "lucide-react";
import { MathText } from "./MathText";
import { parseScoreEntries } from "../lib/assignment-scores";

type AssignmentItem = { questionId: string; position: number; maxScore: number; snapshot: { stem?: string; type?: string; answer?: string; tags?: string[] } };
type Submission = { id: string; classId: string; className: string; studentId: string; studentNo: string; studentName: string; status: string; totalScore: number | null; teacherComment: string; scores: Record<string, number> };
export type AssignmentDetail = {
  assignment: { id: string; paperId: string; paperTitle: string; title: string; assignmentCode: string; status: string; dueAt: string | null; totalScore: number };
  classes: Array<{ id: string; name: string; grade: string }>;
  items: AssignmentItem[];
  submissions: Submission[];
  analytics: {
    gradedCount: number; assignedCount: number; classAverageRate: number;
    students: Array<{ studentId: string; studentName: string; earned: number; maximum: number; rate: number }>;
    questions: Array<{ questionId: string; position: number; earned: number; maximum: number; rate: number; tags: string[] }>;
    tags: Array<{ tag: string; earned: number; maximum: number; rate: number }>;
    weakQuestionIds: string[];
  };
};

function percentage(value: number) { return `${Math.round(value * 100)}%`; }

export function AssignmentWorkspace({ initialDetail }: { initialDetail: AssignmentDetail }) {
  const [detail, setDetail] = useState(initialDetail);
  const [tab, setTab] = useState<"grading" | "analytics">("grading");
  const [classId, setClassId] = useState(initialDetail.classes[0]?.id ?? "");
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const visibleSubmissions = useMemo(() => detail.submissions.filter((submission) => submission.classId === classId), [classId, detail.submissions]);
  const activeSubmission = visibleSubmissions.find((submission) => submission.id === submissionId) ?? visibleSubmissions[0] ?? null;

  async function reload() {
    const response = await fetch(`/api/assignments/${detail.assignment.id}`);
    const result = await response.json().catch(() => ({})) as AssignmentDetail & { error?: string };
    if (!response.ok) { setError(result.error ?? "刷新失败"); return; }
    setDetail(result); setError("");
  }

  async function toggleStatus() {
    setStatusBusy(true);
    const next = detail.assignment.status === "active" ? "closed" : "active";
    const response = await fetch(`/api/assignments/${detail.assignment.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setStatusBusy(false);
    if (!response.ok) { setError(result.error ?? "更新状态失败"); return; }
    setDetail((current) => ({ ...current, assignment: { ...current.assignment, status: next } }));
  }

  return <div className="school-page assignment-workspace-page">
    <header className="assignment-workspace-header"><div><Link href="/assignments"><ArrowLeft size={14} /> 作业列表</Link><h1>{detail.assignment.title}</h1><p>{detail.classes.map((item) => item.name).join("、")} · 满分 {detail.assignment.totalScore} 分</p></div><div><span className={`assignment-status ${detail.assignment.status}`}>{detail.assignment.status === "active" ? "进行中" : "已结束"}</span><code>作业码 {detail.assignment.assignmentCode}</code><Link href={`/assignments/${detail.assignment.id}/answer-sheet`} target="_blank" className="btn btn-small"><Printer size={13} /> 答题卡</Link><button type="button" className="btn btn-small" disabled={statusBusy} onClick={() => void toggleStatus()}>{detail.assignment.status === "active" ? <><Lock size={13} /> 结束作业</> : <><RotateCcw size={13} /> 重新开放</>}</button></div></header>
    <nav className="assignment-workspace-tabs" aria-label="作业工作区"><button type="button" className={tab === "grading" ? "active" : ""} onClick={() => setTab("grading")}><ClipboardPen size={15} /> 逐题录分 <b>{detail.analytics.gradedCount}/{detail.analytics.assignedCount}</b></button><button type="button" className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}><BarChart3 size={15} /> 班级学情 {detail.analytics.gradedCount > 0 && <b>{percentage(detail.analytics.classAverageRate)}</b>}</button></nav>
    {error && <p className="school-inline-error">{error}</p>}
    {tab === "grading" ? <div className="grading-shell"><aside className="grading-roster"><header><div><strong>学生名单</strong><small>{visibleSubmissions.filter((item) => item.status === "graded").length}/{visibleSubmissions.length} 已批</small></div><select aria-label="筛选班级" value={classId} onChange={(event) => { setClassId(event.target.value); setSubmissionId(null); }}>{detail.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></header>{visibleSubmissions.map((submission) => <button type="button" className={submission.id === activeSubmission?.id ? "active" : ""} key={submission.id} onClick={() => setSubmissionId(submission.id)}><span>{submission.studentName.slice(-2)}</span><div><strong>{submission.studentName}</strong><small>{submission.studentNo}</small></div>{submission.status === "graded" ? <b>{submission.totalScore}/{detail.assignment.totalScore}</b> : <em>待批</em>}</button>)}{!visibleSubmissions.length && <p>这个班级布置时还没有学生。</p>}</aside><main className="grading-editor">{activeSubmission ? <SubmissionEditor key={`${activeSubmission.id}:${activeSubmission.status}:${activeSubmission.totalScore}`} assignmentId={detail.assignment.id} submission={activeSubmission} items={detail.items} disabled={detail.assignment.status === "closed"} onSaved={reload} /> : <div className="school-empty"><Users size={32} /><h2>没有可批改的学生</h2><p>请先在班级学生中导入名单，再重新布置一份作业。</p></div>}</main></div> : <AnalyticsPanel detail={detail} />}
  </div>;
}

function SubmissionEditor({ assignmentId, submission, items, disabled, onSaved }: { assignmentId: string; submission: Submission; items: AssignmentItem[]; disabled: boolean; onSaved: () => Promise<void> }) {
  const [scores, setScores] = useState<Record<string, string>>(() => Object.fromEntries(items.map((item) => [item.questionId, submission.scores[item.questionId]?.toString() ?? ""])));
  const [comment, setComment] = useState(submission.teacherComment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = items.reduce((sum, item) => sum + (Number(scores[item.questionId]) || 0), 0);
  async function save() {
    if (disabled || busy) return;
    setBusy(true); setError("");
    try {
      const parsedScores = parseScoreEntries(items, scores);
      const response = await fetch(`/api/assignments/${assignmentId}/scores`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ submissionId: submission.id, scores: parsedScores, teacherComment: comment }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "保存失败"); return; }
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }
  return <><header className="grading-editor-header"><div><span>{submission.studentName.slice(-2)}</span><div><h2>{submission.studentName}</h2><p>{submission.className} · 学号 {submission.studentNo}</p></div></div><strong>{total}/{items.reduce((sum, item) => sum + item.maxScore, 0)} 分</strong></header><div className="score-entry-list">{items.map((item) => <article key={item.questionId}><div className="score-question"><b>{item.position + 1}</b><div><MathText text={item.snapshot.stem ?? "题目快照缺失"} />{item.snapshot.tags?.length ? <small>{item.snapshot.tags.map((tag) => <span key={tag}>#{tag}</span>)}</small> : null}</div></div><label><span>得分</span><div><input disabled={disabled} type="number" min="0" max={item.maxScore} step="0.5" value={scores[item.questionId]} onChange={(event) => setScores({ ...scores, [item.questionId]: event.target.value })} /><i>/ {item.maxScore}</i></div></label></article>)}</div><label className="grading-comment"><span>教师评语（可选）</span><textarea disabled={disabled} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="记录整体表现、需要订正的内容或讲评提醒" /></label>{error && <p className="school-inline-error">{error}</p>}<footer className="grading-save-bar"><span>{disabled ? "作业已结束，如需修改请先重新开放。" : "保存后班级学情会立即重新计算。"}</span><button className="btn btn-primary" type="button" disabled={disabled || busy} onClick={() => void save()}><Save size={14} /> {busy ? "保存中…" : submission.status === "graded" ? "更新得分" : "完成批改"}</button></footer></>;
}

function AnalyticsPanel({ detail }: { detail: AssignmentDetail }) {
  const analytics = detail.analytics;
  if (!analytics.gradedCount) return <div className="school-empty analytics-empty"><BarChart3 size={36} /><h2>完成第一份批改后生成学情</h2><p>系统会按题目、知识点和学生三个维度计算掌握情况。</p></div>;
  const remediationHref = analytics.weakQuestionIds.length ? `/papers/new?ids=${encodeURIComponent(analytics.weakQuestionIds.join(","))}` : "/papers/new";
  return <div className="analytics-panel"><section className="analytics-summary"><article><span><CheckCircle2 size={18} /></span><div><strong>{analytics.gradedCount}/{analytics.assignedCount}</strong><small>已完成批改</small></div></article><article><span><BarChart3 size={18} /></span><div><strong>{percentage(analytics.classAverageRate)}</strong><small>班级平均得分率</small></div></article><article><span><Tag size={18} /></span><div><strong>{analytics.tags.filter((item) => item.rate < 0.7).length}</strong><small>薄弱知识点</small></div></article></section><div className="analytics-grid"><section><header><div><h2>逐题得分率</h2><p>低于 70% 的题目自动进入补练候选</p></div><Link href={remediationHref} className="btn btn-primary btn-small"><FilePlus2 size={13} /> 生成补练卷</Link></header><div className="question-rate-list">{analytics.questions.map((question) => <div key={question.questionId} className={question.rate < 0.7 ? "weak" : ""}><b>第 {question.position + 1} 题</b><span><i><em style={{ width: percentage(question.rate) }} /></i><strong>{percentage(question.rate)}</strong></span><small>{question.tags.join(" · ") || "未标知识点"}</small></div>)}</div></section><section><header><div><h2>知识点掌握</h2><p>按相关题目的实际分值加权</p></div></header><div className="tag-rate-list">{analytics.tags.map((tag) => <div key={tag.tag}><span><b>{tag.tag}</b><small>{tag.earned}/{tag.maximum} 分</small></span><strong className={tag.rate < 0.7 ? "weak" : ""}>{percentage(tag.rate)}</strong></div>)}{!analytics.tags.length && <p>题目还没有知识点标签。</p>}</div></section></div><section className="student-ranking"><header><h2>学生表现</h2><p>用于快速识别需要重点讲评和分层补练的学生</p></header><div>{analytics.students.map((student, index) => <article key={student.studentId}><b>{index + 1}</b><span><strong>{student.studentName}</strong><small>{student.earned}/{student.maximum} 分</small></span><em className={student.rate < 0.6 ? "weak" : ""}>{percentage(student.rate)}</em></article>)}</div></section></div>;
}
