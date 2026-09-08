"use client";

import Link from "next/link";
import { BarChart3, CheckCircle2, ClipboardCheck, Clock3, FilePlus2, Printer, Users } from "lucide-react";

type AssignmentRecord = {
  id: string; title: string; assignmentCode: string; status: string; dueAt: string | null; totalScore: number;
  classCount: number; studentCount: number; gradedCount: number; classNames: string | null; updatedAt: string;
};

function formatDate(value: string | null) {
  if (!value) return "不限截止时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function AssignmentList({ initialAssignments }: { initialAssignments: AssignmentRecord[] }) {
  const active = initialAssignments.filter((assignment) => assignment.status === "active");
  const closed = initialAssignments.filter((assignment) => assignment.status === "closed");
  return <div className="school-page assignment-list-page">
    <header className="school-page-header"><div><span><ClipboardCheck size={14} /> 教学任务</span><h1>作业与批改</h1><p>从现有试卷直接布置，逐题录分后自动形成班级学情和补练入口。</p></div><Link href="/assignments/new" className="btn btn-primary"><FilePlus2 size={15} /> 布置作业</Link></header>
    <section className="assignment-overview"><article><span><Clock3 size={18} /></span><div><strong>{active.length}</strong><small>进行中</small></div></article><article><span><Users size={18} /></span><div><strong>{active.reduce((sum, item) => sum + item.studentCount, 0)}</strong><small>待收学生</small></div></article><article><span><CheckCircle2 size={18} /></span><div><strong>{initialAssignments.reduce((sum, item) => sum + item.gradedCount, 0)}</strong><small>已批改份数</small></div></article></section>
    {active.length > 0 && <section className="assignment-section"><header><h2>进行中的作业</h2><span>{active.length} 项</span></header><div className="assignment-card-grid">{active.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} />)}</div></section>}
    {closed.length > 0 && <section className="assignment-section muted"><header><h2>已结束</h2><span>{closed.length} 项</span></header><div className="assignment-card-grid">{closed.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} />)}</div></section>}
    {!initialAssignments.length && <div className="school-empty assignment-empty"><ClipboardCheck size={38} /><h2>还没有布置过作业</h2><p>选择试卷与班级后，系统会冻结题目版本并为名单中的学生建立批改记录。</p><Link href="/assignments/new" className="btn btn-primary"><FilePlus2 size={14} /> 布置第一份作业</Link></div>}
  </div>;
}

function AssignmentCard({ assignment }: { assignment: AssignmentRecord }) {
  const rate = assignment.studentCount ? assignment.gradedCount / assignment.studentCount : 0;
  return <article className="assignment-card"><header><span className={`assignment-status ${assignment.status}`}>{assignment.status === "active" ? "进行中" : "已结束"}</span><code>{assignment.assignmentCode}</code></header><Link href={`/assignments/${assignment.id}`}><h3>{assignment.title}</h3><p>{assignment.classNames || "尚无班级"}</p></Link><div className="assignment-progress"><div><span>批改进度</span><b>{assignment.gradedCount}/{assignment.studentCount}</b></div><i><span style={{ width: `${Math.round(rate * 100)}%` }} /></i></div><dl><div><dt>截止</dt><dd>{formatDate(assignment.dueAt)}</dd></div><div><dt>满分</dt><dd>{assignment.totalScore} 分</dd></div></dl><footer><Link href={`/assignments/${assignment.id}`}><BarChart3 size={13} /> 批改与学情</Link><Link href={`/assignments/${assignment.id}/answer-sheet`} target="_blank"><Printer size={13} /> 答题卡</Link></footer></article>;
}
