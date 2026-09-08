"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Check, ClipboardCheck, FileText, Users } from "lucide-react";
import type { PaperLibraryRecord } from "../lib/paper-library";
import type { TeachingClassRecord } from "../lib/school-workflow";

export function AssignmentCreator({ classes, papers, initialPaperId }: { classes: TeachingClassRecord[]; papers: PaperLibraryRecord[]; initialPaperId: string | null }) {
  const router = useRouter();
  const availablePapers = papers.filter((paper) => paper.questionCount > 0);
  const initialPaper = availablePapers.find((paper) => paper.id === initialPaperId) ?? availablePapers[0];
  const [paperId, setPaperId] = useState(initialPaper?.id ?? "");
  const [title, setTitle] = useState(initialPaper?.title ?? "");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedPaper = useMemo(() => availablePapers.find((paper) => paper.id === paperId), [availablePapers, paperId]);

  function choosePaper(id: string) {
    setPaperId(id);
    const paper = availablePapers.find((item) => item.id === id);
    if (paper && (!title.trim() || availablePapers.some((item) => item.title === title))) setTitle(paper.title);
  }

  async function create() {
    setBusy(true); setError("");
    const response = await fetch("/api/assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paperId, title, classIds, dueAt }) });
    const result = await response.json().catch(() => ({})) as { assignment?: { id: string }; error?: string };
    setBusy(false);
    if (!response.ok || !result.assignment) { setError(result.error ?? "布置失败"); return; }
    router.push(`/assignments/${result.assignment.id}`); router.refresh();
  }

  return <div className="school-page assignment-creator-page">
    <header className="assignment-creator-header"><Link href="/assignments"><ArrowLeft size={15} /> 返回作业</Link><span>布置新作业</span></header>
    <div className="assignment-creator-shell"><main><div className="assignment-step"><span>1</span><div><h2>选择试卷</h2><p>布置后会保存独立快照，之后编辑原试卷不会影响这次作业。</p></div></div><label className="assignment-paper-select"><FileText size={17} /><span><small>来源试卷</small><select value={paperId} onChange={(event) => choosePaper(event.target.value)}><option value="">请选择试卷</option>{availablePapers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}（{paper.questionCount} 题）</option>)}</select></span></label>{selectedPaper && <div className="selected-paper-summary"><strong>{selectedPaper.title}</strong><span>{selectedPaper.subject} · {selectedPaper.questionCount} 道题 · 最近更新 {new Date(selectedPaper.updatedAt).toLocaleDateString("zh-CN")}</span></div>}
      <div className="assignment-step"><span>2</span><div><h2>选择班级</h2><p>当前名单中的学生会被加入本次作业，后续调整班级不会改写历史。</p></div></div><div className="assignment-class-grid">{classes.map((item) => { const checked = classIds.includes(item.id); return <button type="button" className={checked ? "selected" : ""} key={item.id} onClick={() => setClassIds((ids) => checked ? ids.filter((id) => id !== item.id) : [...ids, item.id])}><span>{checked ? <Check size={15} /> : <Users size={15} />}</span><div><strong>{item.name}</strong><small>{item.grade} · {item.studentCount} 人</small></div></button>; })}</div>{!classes.length && <div className="assignment-missing"><p>还没有可用班级，请先建立班级并导入学生。</p><Link href="/classes" className="btn btn-small">去管理班级</Link></div>}
      <div className="assignment-step"><span>3</span><div><h2>填写作业信息</h2><p>截止时间可以留空，作业码会在布置后自动生成。</p></div></div><div className="assignment-form-grid"><label><span>作业名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：函数单元巩固练习" /></label><label><span>截止时间（可选）</span><div><CalendarClock size={14} /><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div></label></div>{error && <p className="school-inline-error">{error}</p>}</main><aside><ClipboardCheck size={28} /><h2>确认布置</h2><dl><div><dt>试卷</dt><dd>{selectedPaper?.title ?? "未选择"}</dd></div><div><dt>题目</dt><dd>{selectedPaper?.questionCount ?? 0} 道</dd></div><div><dt>班级</dt><dd>{classIds.length} 个</dd></div><div><dt>学生</dt><dd>{classes.filter((item) => classIds.includes(item.id)).reduce((sum, item) => sum + item.studentCount, 0)} 人</dd></div></dl><button className="btn btn-primary" type="button" disabled={busy || !paperId || !title.trim() || !classIds.length} onClick={() => void create()}>{busy ? "正在建立作业…" : "确认布置"}</button><small>系统会为每名学生创建一份待批改记录。</small></aside></div>
  </div>;
}
