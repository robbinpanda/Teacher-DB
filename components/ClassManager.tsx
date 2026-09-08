"use client";

import { useMemo, useRef, useState } from "react";
import { Download, GraduationCap, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import type { TeachingClassRecord } from "../lib/school-workflow";

type Student = { id: string; studentNo: string; name: string; seatNumber: string | null };
type ClassDetail = TeachingClassRecord & { students: Student[] };

function defaultSchoolYear() {
  const date = new Date();
  const start = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

export function ClassManager({ initialClasses, initialDetail }: { initialClasses: TeachingClassRecord[]; initialDetail: ClassDetail | null }) {
  const [classes, setClasses] = useState(initialClasses);
  const [selectedId, setSelectedId] = useState(initialClasses.find((item) => !item.archived)?.id ?? null);
  const [detail, setDetail] = useState<ClassDetail | null>(initialDetail);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", grade: "", subject: "数学", schoolYear: defaultSchoolYear() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadDetail(classId: string) {
    const response = await fetch(`/api/classes/${classId}`);
    const result = await response.json().catch(() => ({})) as { teachingClass?: ClassDetail; error?: string };
    if (!response.ok || !result.teachingClass) { setError(result.error ?? "无法读取班级"); return; }
    setDetail(result.teachingClass);
  }

  async function selectClass(classId: string) {
    setSelectedId(classId); setSearch(""); setError("");
    await loadDetail(classId);
  }

  const visibleStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return detail?.students.filter((student) => !query || `${student.studentNo} ${student.name} ${student.seatNumber ?? ""}`.toLocaleLowerCase("zh-CN").includes(query)) ?? [];
  }, [detail, search]);

  async function createClass() {
    setBusy(true); setError("");
    const response = await fetch("/api/classes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json().catch(() => ({})) as { teachingClass?: TeachingClassRecord; error?: string };
    setBusy(false);
    if (!response.ok || !result.teachingClass) { setError(result.error ?? "无法创建班级"); return; }
    setClasses((items) => [result.teachingClass!, ...items]);
    setSelectedId(result.teachingClass.id); setCreating(false);
    await loadDetail(result.teachingClass.id);
    setForm({ name: "", grade: "", subject: "数学", schoolYear: defaultSchoolYear() });
  }

  async function importRoster(file: File) {
    if (!selectedId) return;
    setBusy(true); setError("");
    const data = new FormData(); data.append("file", file);
    const response = await fetch(`/api/classes/${selectedId}/import`, { method: "POST", body: data });
    const result = await response.json().catch(() => ({})) as { imported?: number; studentCount?: number; error?: string };
    setBusy(false);
    if (!response.ok) { setError(result.error ?? "名单导入失败"); return; }
    await loadDetail(selectedId);
    setClasses((items) => items.map((item) => item.id === selectedId ? { ...item, studentCount: result.studentCount ?? item.studentCount } : item));
  }

  async function removeStudent(student: Student) {
    if (!selectedId || !window.confirm(`从本班移除“${student.name}”？历史作业不会被删除。`)) return;
    const response = await fetch(`/api/classes/${selectedId}/students/${student.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(result.error ?? "移除失败"); return; }
    setDetail((current) => current ? { ...current, students: current.students.filter((item) => item.id !== student.id), studentCount: current.studentCount - 1 } : current);
    setClasses((items) => items.map((item) => item.id === selectedId ? { ...item, studentCount: Math.max(0, item.studentCount - 1) } : item));
  }

  function downloadTemplate() {
    const blob = new Blob(["\uFEFF学号,姓名,座号\n2026001,张同学,1\n2026002,李同学,2\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "班级名单模板.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="school-page class-manager-page">
    <header className="school-page-header"><div><span><GraduationCap size={14} /> 学校教师</span><h1>班级与学生</h1><p>名单只需导入一次，之后布置、批改、学情和补练都会自动归到学生。</p></div><button className="btn btn-primary" type="button" onClick={() => setCreating(true)}><Plus size={15} /> 新建班级</button></header>
    <div className="class-manager-shell">
      <aside className="class-list-panel"><div><strong>我的班级</strong><small>{classes.filter((item) => !item.archived).length} 个在教班级</small></div>{classes.filter((item) => !item.archived).map((item) => <button type="button" className={item.id === selectedId ? "active" : ""} key={item.id} onClick={() => void selectClass(item.id)}><span>{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.grade} · {item.subject}</small></div><b>{item.studentCount} 人</b></button>)}{!classes.length && <p className="class-list-empty">先建立一个任教班级。</p>}</aside>
      <main className="class-detail-panel">
        {detail ? <><header><div><h2>{detail.name}</h2><p>{detail.schoolYear} 学年 · {detail.grade} · {detail.subject}</p></div><div className="class-roster-actions"><button type="button" className="btn btn-small" onClick={downloadTemplate}><Download size={13} /> 名单模板</button><button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={13} /> {busy ? "导入中…" : "导入 CSV"}</button><input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRoster(file); event.currentTarget.value = ""; }} /></div></header><div className="class-roster-toolbar"><label><Search size={14} /><input aria-label="搜索学生" placeholder="搜索姓名、学号或座号" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span><Users size={14} /> {detail.students.length} 名学生</span></div>{error && <p className="school-inline-error">{error}</p>}<div className="roster-table"><div className="roster-head"><span>座号</span><span>学号</span><span>姓名</span><span>操作</span></div>{visibleStudents.map((student) => <div className="roster-row" key={student.id}><span>{student.seatNumber ?? "—"}</span><span>{student.studentNo}</span><strong>{student.name}</strong><button type="button" title="从班级移除" aria-label={`移除${student.name}`} onClick={() => void removeStudent(student)}><Trash2 size={13} /></button></div>)}</div>{!detail.students.length && <div className="school-empty"><Users size={32} /><h2>班级还没有学生</h2><p>下载模板填好学号、姓名与座号，再导入 CSV。</p><button className="btn btn-primary" type="button" onClick={() => fileRef.current?.click()}><Upload size={14} /> 导入名单</button></div>}</> : <div className="school-empty"><GraduationCap size={34} /><h2>建立第一个班级</h2><p>班级是作业、成绩与错题分析的归属单位。</p><button className="btn btn-primary" type="button" onClick={() => setCreating(true)}><Plus size={14} /> 新建班级</button></div>}
      </main>
    </div>
    {creating && <div className="school-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><form role="dialog" aria-modal="true" aria-labelledby="create-class-title" onSubmit={(event) => { event.preventDefault(); void createClass(); }}><h2 id="create-class-title">新建任教班级</h2><p>学年与班名用于区分历届班级，后续可归档。</p><label><span>班级名称</span><input autoFocus placeholder="例如：高一（3）班" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><div className="school-form-grid"><label><span>年级</span><input placeholder="例如：高一" value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} /></label><label><span>学科</span><input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label></div><label><span>学年</span><input value={form.schoolYear} onChange={(event) => setForm({ ...form, schoolYear: event.target.value })} /></label>{error && <p className="school-inline-error">{error}</p>}<footer><button type="button" className="btn" onClick={() => setCreating(false)}>取消</button><button type="submit" className="btn btn-primary" disabled={busy || !form.name.trim() || !form.grade.trim()}>{busy ? "创建中…" : "创建班级"}</button></footer></form></div>}
  </div>;
}
