"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { BookOpen, Check, ChevronRight, Download, FlaskConical, Search, Sparkles, Upload } from "lucide-react";
import { subjects } from "../lib/education-taxonomy";
import { builtInTeachingSkill, skillGrades } from "../lib/teaching-skill-catalog";
import type { SkillTrial, TeachingSkill } from "../lib/teaching-skill-store";
import { MathText } from "./MathText";

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "请求失败，请重试");
  return data;
}
function downloadSkill(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${name.replace(/[^\w\u4e00-\u9fff-]/g, "-")}-SKILL.md`; anchor.click();
  URL.revokeObjectURL(url);
}

export function TeachingSkills() {
  const [subject, setSubject] = useState<string>("数学");
  const [grade, setGrade] = useState("九年级");
  const canLeaveRef = useRef<() => boolean>(() => true);
  return <div className="school-page skill-page">
    <header className="school-page-header"><div><h1>教学 Skills</h1><p>把常用试卷的识别经验，保存成可复用的方案。</p></div></header>
    <div className="skill-scope skill-library-scope"><label>学科<select value={subject} onChange={e => { if (canLeaveRef.current()) setSubject(e.target.value); }}>{subjects.map(s => <option key={s}>{s}</option>)}</select></label><label>年级<select value={grade} onChange={e => { if (canLeaveRef.current()) setGrade(e.target.value); }}>{skillGrades.map(g => <option key={g}>{g}</option>)}</select></label><span>每个学科、年级可启用一个个人方案</span></div>
    <SkillWorkbench key={`${subject}/${grade}`} subject={subject} grade={grade} canLeaveRef={canLeaveRef} />
  </div>;
}

function SkillWorkbench({ subject, grade, canLeaveRef }: { subject: string; grade: string; canLeaveRef: RefObject<() => boolean> }) {
  const [view, setView] = useState<"home" | "create" | "detail" | "default">("home");
  const [tab, setTab] = useState<"overview" | "test" | "advanced">("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<TeachingSkill[]>([]);
  const [protocol, setProtocol] = useState("");
  const [selected, setSelected] = useState<TeachingSkill | null>(null);
  const [trials, setTrials] = useState<SkillTrial[]>([]);
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [profiles, setProfiles] = useState<Array<{ id: string; displayName: string }>>([]);
  const [profileId, setProfileId] = useState("");
  const [reviewerProfileId, setReviewerProfileId] = useState("");
  const [compareGrade, setCompareGrade] = useState(grade === "高三" ? "高二" : "高三");
  const [compareSubject, setCompareSubject] = useState(subject);
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0);
  const base = builtInTeachingSkill(subject, grade);
  const dirty = Boolean(selected && (content !== selected.content || name !== selected.name));
  const latest = trials.find(trial => trial.revision === selected?.revision);
  useEffect(() => {
    canLeaveRef.current = () => !busy && (!dirty || window.confirm("方案有未保存修改，确定切换适用范围？"));
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { canLeaveRef.current = () => true; window.removeEventListener("beforeunload", beforeUnload); };
  }, [busy, dirty, canLeaveRef]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([requestJson(`/api/teaching-skills?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`), requestJson("/api/model-profiles")]).then(([catalog, models]) => {
      if (cancelled) return;
      setSkills(catalog.skills); setProtocol(catalog.protocol);
      setProfiles((models.profiles ?? []).filter((profile: { enabled: boolean }) => profile.enabled));
      setLoading(false);
    }).catch(error => { if (!cancelled) { setError(error.message); setLoading(false); } });
    return () => { cancelled = true; sequence.current += 1; };
  }, [subject, grade]);

  async function refresh(id?: string) {
    const ticket = ++sequence.current;
    const catalog = await requestJson(`/api/teaching-skills?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`);
    const detail = id ? await requestJson(`/api/teaching-skills/${id}`) : null;
    if (ticket !== sequence.current) return;
    setSkills(catalog.skills);
    if (detail) { setSelected(detail.skill); setTrials(detail.trials); setContent(detail.skill.content); setName(detail.skill.name); setConfirmed(false); setNotes(""); }
  }
  async function action(label: string, run: () => Promise<void>) {
    setBusy(label); setError(""); setMessage("");
    try { await run(); }
    catch (error) { setError(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(""); }
  }
  async function mutate(operation: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    await action(operation === "trial" ? "试识别与模型复核中…" : operation === "refine" ? "根据复核意见改进 Skill…" : "保存中…", async () => {
      await requestJson(`/api/teaching-skills/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: operation, revision: selected.revision, ...extra }) });
      await refresh(selected.id);
      if (operation === "trial" || operation === "review") setTab("test");
      if (operation === "refine") setTab("overview");
      setMessage(operation === "activate" ? "已启用：后续相同年级、学科的正式识题和变式生成将使用这个版本。" : operation === "save" || operation === "refine" ? "已保存新版本，需要重新试识别与人工复核。" : "操作已保存。");
    });
  }

  function navigate(next: typeof view) {
    if (busy || (dirty && !window.confirm("放弃尚未保存的修改？"))) return;
    if (selected && dirty) { setContent(selected.content); setName(selected.name); }
    setView(next); setError(""); setMessage("");
  }
  const summary = content.replace(/^---[\s\S]*?---/, "").split("\n").map(line => line.replace(/^[#*\-\s]+/, "").trim()).filter(Boolean).slice(0, 8);
  return <>
    <div className="resource-actions skill-navigation">{view !== "home" && <button className="btn" disabled={!!busy} onClick={() => navigate("home")}>返回我的识别方案</button>}<button className="btn btn-primary" disabled={!!busy} onClick={() => navigate("create")}>+ 创建 Skill</button><Link className="btn" href="/?import=1">去工作台使用</Link></div>
    {view === "home" && <>
      <section className="skill-card skill-default-card"><span className="skill-scheme-icon" aria-hidden="true"><BookOpen size={22} strokeWidth={1.7} /></span><div><h2>默认识别方案<span className="resource-badge">系统内置</span></h2><p>{grade} · {subject} · 默认规则始终生效，个人方案补充你的识别偏好。</p></div><button className="btn" onClick={() => navigate("default")}>查看默认规则<ChevronRight size={14} /></button></section>
      <section className="skill-card skill-personal-card"><header><div><h2>我的识别方案<span className="skill-count">{skills.length}</span></h2><p>上传样例生成方案，核对效果后启用。</p></div><label className="skill-search"><Search size={16} /><input aria-label="搜索识别方案" placeholder="搜索方案名称…" value={search} onChange={event => setSearch(event.target.value)} /></label></header>
        {loading ? <p role="status">正在读取识别方案…</p> : error ? <p role="alert">{error}</p> : !skills.length ? <div className="skill-empty"><h3>从一份常用试卷开始</h3><p>上传样例图片 → AI 生成候选规则 → 试识别与人工核对 → 启用并复用</p><button className="btn" onClick={() => navigate("create")}>上传样例创建 Skill</button></div> : <div className="skill-catalog">{skills.filter(skill => skill.name.includes(search.trim())).map(skill => <article key={skill.id}><span className="skill-scheme-icon personal" aria-hidden="true"><Sparkles size={21} strokeWidth={1.7} /></span><div className="skill-catalog-info"><strong>{skill.name}</strong><p>{skill.grade} · {skill.subject} · v{skill.revision} · 更新于 {new Date(skill.updatedAt).toLocaleDateString("zh-CN")}</p></div><span className={`resource-badge skill-state${skill.active ? " active" : ""}`}><i />{skill.active ? "已启用" : "未启用"}</span><button className="btn" disabled={!!busy} onClick={() => void action("读取方案…", async () => { await refresh(skill.id); setView("detail"); setTab("overview"); })}>查看与编辑<ChevronRight size={14} /></button></article>)}{!skills.some(skill => skill.name.includes(search.trim())) && <p>没有匹配的方案，请调整搜索。</p>}</div>}
      </section>
    </>}
    {view === "default" && <>
    <section className="skill-card"><header><div><h2>默认方案 · 高级规则</h2><p>共同输出协议保持稳定，年级与学科规则在此基础上细化。个人规则无法跳过逐字转录和复核要求。</p></div><button className="btn btn-small" onClick={() => downloadSkill(`${grade}-${subject}`, base)}><Download size={14} /> 导出 Skill</button></header>
      <div className="skill-compare"><div><h3>{grade} · {subject}</h3><pre>{base}</pre></div><div><div className="skill-scope"><label>对照学科<select value={compareSubject} onChange={e => setCompareSubject(e.target.value)}>{subjects.map(s => <option key={s}>{s}</option>)}</select></label><label>对照年级<select value={compareGrade} onChange={e => setCompareGrade(e.target.value)}>{skillGrades.map(g => <option key={g}>{g}</option>)}</select></label></div><pre>{builtInTeachingSkill(compareSubject, compareGrade)}</pre></div></div>
      <details><summary>查看正式识题的完整共同输出协议</summary><pre>{protocol || "读取中…"}</pre></details>
    </section>
    </>}
    {view === "create" && <section className="skill-card skill-create-card"><header><div><h2>创建识别方案</h2><p>选择一份常用试卷，让 AI 提炼版式特点和识别规则。</p></div></header><ol className="skill-create-steps" aria-label="方案创建流程">{["上传样例", "生成草稿", "测试与核对", "启用方案"].map((step, index) => <li key={step} className={index === 0 ? "current" : ""}><span>{index + 1}</span>{step}</li>)}</ol>
      <div className="skill-scope"><label>生成与识别模型<select value={profileId} disabled={!!busy} onChange={e => setProfileId(e.target.value)}><option value="">使用默认模型</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label><label>独立复核模型<select value={reviewerProfileId} disabled={!!busy} onChange={e => setReviewerProfileId(e.target.value)}><option value="">同模型，独立上下文</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label></div>
      <label className={`skill-upload${file ? " has-file" : ""}`}><span className="skill-upload-icon"><Upload size={24} strokeWidth={1.7} /></span><strong>{file ? file.name : "选择一张试卷样例图片"}</strong><span>{file ? "点击重新选择图片" : "PNG、JPEG 或 WebP · 最大 12 MB"}</span><input aria-label="上传试卷样例图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><div className="skill-create-footer"><p>先生成草稿，测试并人工核对后再启用。</p><button className="btn btn-primary" disabled={!!busy || !file} onClick={() => void action("读取试卷并生成 Skill…", async () => {
        const data = new FormData(); data.append("subject", subject); data.append("grade", grade); data.append("profileId", profileId); data.append("file", file!);
        const result = await requestJson("/api/teaching-skills", { method: "POST", body: data }); await refresh(result.skill.id); setView("detail"); setTab("overview");
        setMessage("个人草稿已生成，请查看并修改，再点击试识别。");
      })}><Upload size={14} /> 生成个人草稿</button></div>
    </section>}
    {view === "detail" && <section className="skill-card"><header><div><h2>识别方案详情</h2><p>修改后的版本必须重新验证。通过人工复核后，可单独启用；停用后回到默认 Skill。</p></div></header>
      {selected && <>
        <div className="resource-tabs" role="tablist" aria-label="方案详情">{([['overview','概览'],['test','测试与效果'],['advanced','高级规则']] as const).map(([value,label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
        {tab === "overview" && <div className="skill-overview"><h3>{selected.name}</h3><p>{grade} · {subject} · v{selected.revision} · {selected.active ? "已启用" : "未启用"}</p><p>当前版本：{!latest ? "尚未测试" : latest.humanVerdict === "approved" ? "原样例人工复核通过" : latest.humanVerdict === "rejected" ? "人工复核未通过" : "已试识别，待人工复核"}。单份样例通过不代表其他格式也适用。</p><h3>规则摘要</h3><ul>{summary.map((line,index) => <li key={index}>{line}</li>)}</ul><p>摘要节选自实际规则，完整内容见高级规则。</p><button className="btn btn-primary" onClick={() => setTab("test")}>3. 测试并核对识别效果</button></div>}
        {tab === "advanced" && <>

        <label className="skill-field">名称<input maxLength={100} value={name} disabled={!!busy} onChange={e => setName(e.target.value)} /></label>
        <label className="skill-field">个人 Skill · v{selected.revision}{selected.active ? " · 正在使用" : " · 未启用"}<textarea spellCheck={false} rows={15} maxLength={12000} value={content} disabled={!!busy} onChange={e => setContent(e.target.value)} /></label>
        </>}
        <div className="skill-actions"><button className="btn" disabled={!!busy || !dirty} onClick={() => void mutate("save", { content, name })}>保存新版本</button><button className="btn" disabled={!!busy} onClick={() => downloadSkill(name, content)}><Download size={14} /> 导出</button><button className="btn btn-primary" disabled={!!busy || dirty || !selected.sampleKey} onClick={() => void mutate("trial", { profileId, reviewerProfileId })}><FlaskConical size={14} /> 用当前版本试识别并复核</button><button className="btn" disabled={!!busy || dirty || latest?.humanVerdict !== "approved" || !!selected.active} onClick={() => void mutate("activate")}><Check size={14} /> 4. 启用已复核版本</button>{!!selected.active && <button className="btn" disabled={!!busy} onClick={() => void mutate("deactivate")}>停用</button>}</div>
        {dirty && <p>有未保存修改；试识别前请先保存。</p>}
        {tab === "test" && <><p>{selected.sampleKey ? "使用生成方案时保存的原始样例测试；目前不支持更换测试样例。" : "此方案未保存样例，无法试识别。请通过上传样例创建新的方案。"}</p><div className="skill-scope"><label>识别模型<select value={profileId} disabled={!!busy} onChange={e => setProfileId(e.target.value)}><option value="">默认模型</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label><label>复核模型<select value={reviewerProfileId} disabled={!!busy} onChange={e => setReviewerProfileId(e.target.value)}><option value="">同模型独立复核</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label></div><div className="skill-review-grid"><div>{selected.sampleKey && <><h3>原始样例</h3><a href={`/api/files/${selected.sampleKey}`} target="_blank" rel="noreferrer">打开原图放大核对</a><Image src={`/api/files/${selected.sampleKey}`} width={1200} height={1800} unoptimized alt="用于 Skill 生成与试识别的原始试卷" className="skill-sample" /></>}</div><div>
          {latest ? <><h3>当前版本试识别 · {latest.recognition.questions.length} 题</h3><p>识别：{latest.modelName} · 复核：{latest.reviewerName}</p><p className={latest.review.accurate && latest.review.reasonable ? "skill-success" : "school-inline-error"}>模型判断：{latest.review.accurate ? "准确性通过" : "准确性有疑点"} · {latest.review.reasonable ? "合理性通过" : "合理性有疑点"}</p><p>{latest.review.summary}</p>
            {latest.recognition.warnings.map((warning, i) => <p key={i} className="school-inline-error">{warning}</p>)}
            {latest.review.issues.map((issue, i) => <p key={i} className="school-inline-error">{issue.number} · {issue.field}：{issue.reason}</p>)}
            {latest.recognition.questions.map(q => <article className="skill-question" key={q.number}><h4>题号 {q.number}{q.needsHumanReview ? " · 待人工核查" : ""}</h4><MathText text={q.stem} />{q.options.map((option, i) => <MathText key={i} text={option} />)}<p>原卷答案：{q.answer || "未识别到可见答案"}</p><MathText text={q.analysis} /><small>图中依据：{q.evidence}</small></article>)}
            <label className="skill-field">人工复核说明<textarea value={notes} maxLength={3000} disabled={!!busy || dirty} onChange={e => setNotes(e.target.value)} placeholder="记录错在哪里、如何改进 Skill；若模型有疑点但人工通过，请说明核对依据（至少10字）。" /></label>
            <button className="btn" disabled={!!busy || dirty} onClick={() => void mutate("refine", { feedback: notes, profileId })}>根据模型与人工意见改进 Skill</button>
            <label><input type="checkbox" checked={confirmed} disabled={!!busy || dirty} onChange={e => setConfirmed(e.target.checked)} /> 我已对照原图逐题检查完整性、准确性与合理性</label>
            <p>人工结论：{latest.humanVerdict === "approved" ? "已通过" : latest.humanVerdict === "rejected" ? "需改进" : "待复核"}{latest.humanNotes && ` · ${latest.humanNotes}`}</p>
            <div className="skill-actions"><button className="btn btn-primary" disabled={!!busy || dirty || !confirmed} onClick={() => void mutate("review", { trialId: latest.id, verdict: "approved", notes, confirmed })}>人工通过</button><button className="btn" disabled={!!busy || dirty || !confirmed} onClick={() => void mutate("review", { trialId: latest.id, verdict: "rejected", notes, confirmed })}>退回改进</button></div>
          </> : <p>保存草稿后点击“用当前版本试识别并复核”，结果会与原图并排显示。旧版本的复核不能用于启用当前版本。</p>}
          {trials.length > 0 && <details><summary>试识别历史（最近20次）</summary>{trials.map(trial => <details key={trial.id}><summary>v{trial.revision} · {trial.createdAt} · {trial.humanVerdict}</summary><p>{trial.review.summary}</p><p>{trial.humanNotes}</p><pre>{trial.contentSnapshot}</pre><pre>{JSON.stringify(trial.recognition, null, 2)}</pre></details>)}</details>}
        </div></div></>}
      </>}
    </section>}
    <div className="skill-status" aria-live="polite">{busy && <p>{busy}</p>}{error && <p role="alert" className="school-inline-error">{error}</p>}{message && <p className="skill-success">{message}</p>}</div>
  </>;
}
