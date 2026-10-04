"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Download, FlaskConical, Upload } from "lucide-react";
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
  return <div className="school-page skill-page">
    <header className="school-page-header"><div><span><BookOpen size={14} /> 教学规则与个人经验</span><h1>教学 Skills</h1><p>看清每个年级、学科的提示词，用自己的试卷检验并改进识题规则。</p></div></header>
    <div className="skill-scope"><label>学科<select value={subject} onChange={e => setSubject(e.target.value)}>{subjects.map(s => <option key={s}>{s}</option>)}</select></label><label>年级<select value={grade} onChange={e => setGrade(e.target.value)}>{skillGrades.map(g => <option key={g}>{g}</option>)}</select></label><span>12 个年级 × 10 个学科 · 每个范围可启用一个个人版本</span></div>
    <SkillWorkbench key={`${subject}/${grade}`} subject={subject} grade={grade} />
  </div>;
}

function SkillWorkbench({ subject, grade }: { subject: string; grade: string }) {
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
    let cancelled = false;
    Promise.all([requestJson(`/api/teaching-skills?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`), requestJson("/api/model-profiles")]).then(([catalog, models]) => {
      if (cancelled) return;
      setSkills(catalog.skills); setProtocol(catalog.protocol);
      setProfiles((models.profiles ?? []).filter((profile: { enabled: boolean }) => profile.enabled));
    }).catch(error => { if (!cancelled) setError(error.message); });
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
      setMessage(operation === "activate" ? "已启用：后续相同年级、学科的正式识题和变式生成将使用这个版本。" : operation === "save" || operation === "refine" ? "已保存新版本，需要重新试识别与人工复核。" : "操作已保存。");
    });
  }

  return <>
    <section className="skill-card"><header><div><h2>① 查看默认 Skill 与差异</h2><p>共同输出协议保持稳定，年级与学科规则在此基础上细化。个人规则无法跳过逐字转录和复核要求。</p></div><button className="btn btn-small" onClick={() => downloadSkill(`${grade}-${subject}`, base)}><Download size={14} /> 导出 Skill</button></header>
      <div className="skill-compare"><div><h3>{grade} · {subject}</h3><pre>{base}</pre></div><div><div className="skill-scope"><label>对照学科<select value={compareSubject} onChange={e => setCompareSubject(e.target.value)}>{subjects.map(s => <option key={s}>{s}</option>)}</select></label><label>对照年级<select value={compareGrade} onChange={e => setCompareGrade(e.target.value)}>{skillGrades.map(g => <option key={g}>{g}</option>)}</select></label></div><pre>{builtInTeachingSkill(compareSubject, compareGrade)}</pre></div></div>
      <details><summary>查看正式识题的完整共同输出协议</summary><pre>{protocol || "读取中…"}</pre></details>
    </section>
    <section className="skill-card"><header><div><h2>② 上传试卷，生成我的 Skill</h2><p>上传一张 PNG / JPEG / WebP 试卷图片（最多12MB）。模型提炼版式和易错规则；草稿不会自动启用。</p></div></header>
      <div className="skill-scope"><label>生成与识别模型<select value={profileId} disabled={!!busy} onChange={e => setProfileId(e.target.value)}><option value="">使用默认模型</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label><label>独立复核模型<select value={reviewerProfileId} disabled={!!busy} onChange={e => setReviewerProfileId(e.target.value)}><option value="">同模型，独立上下文</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.displayName}</option>)}</select></label></div>
      <div className="skill-scope"><input aria-label="上传试卷样例图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /><button className="btn btn-primary" disabled={!!busy || !file} onClick={() => void action("读取试卷并生成 Skill…", async () => {
        const data = new FormData(); data.append("subject", subject); data.append("grade", grade); data.append("profileId", profileId); data.append("file", file!);
        const result = await requestJson("/api/teaching-skills", { method: "POST", body: data }); await refresh(result.skill.id);
        setMessage("个人草稿已生成，请查看并修改，再点击试识别。");
      })}><Upload size={14} /> 生成个人草稿</button></div>
    </section>
    <section className="skill-card"><header><div><h2>③ 编辑、试识别和复核</h2><p>修改后的版本必须重新验证。通过人工复核后，可单独启用；停用后回到默认 Skill。</p></div></header>
      <div className="skill-scope"><label>我的版本<select value={selected?.id ?? ""} disabled={!!busy} onChange={e => { if (e.target.value && (!dirty || window.confirm("放弃尚未保存的修改并切换 Skill？"))) void action("读取中…", () => refresh(e.target.value)); }}><option value="">选择个人 Skill</option>{skills.map(skill => <option value={skill.id} key={skill.id}>{skill.name} · v{skill.revision}{skill.active ? " · 已启用" : " · 草稿"}</option>)}</select></label>{skills.length === 0 && <p>此范围还没有个人 Skill，先上传一张试卷。</p>}</div>
      {selected && <>
        <label className="skill-field">名称<input maxLength={100} value={name} disabled={!!busy} onChange={e => setName(e.target.value)} /></label>
        <label className="skill-field">个人 Skill · v{selected.revision}{selected.active ? " · 正在使用" : " · 未启用"}<textarea spellCheck={false} rows={15} maxLength={12000} value={content} disabled={!!busy} onChange={e => setContent(e.target.value)} /></label>
        <div className="skill-actions"><button className="btn" disabled={!!busy || !dirty} onClick={() => void mutate("save", { content, name })}>保存新版本</button><button className="btn" disabled={!!busy} onClick={() => downloadSkill(name, content)}><Download size={14} /> 导出</button><button className="btn btn-primary" disabled={!!busy || dirty} onClick={() => void mutate("trial", { profileId, reviewerProfileId })}><FlaskConical size={14} /> 用当前版本试识别并复核</button><button className="btn" disabled={!!busy || dirty || latest?.humanVerdict !== "approved" || !!selected.active} onClick={() => void mutate("activate")}><Check size={14} /> 启用已复核版本</button>{!!selected.active && <button className="btn" disabled={!!busy} onClick={() => void mutate("deactivate")}>停用</button>}</div>
        {dirty && <p>有未保存修改；试识别前请先保存。</p>}
        <div className="skill-review-grid"><div>{selected.sampleKey && <><h3>原始样例</h3><a href={`/api/files/${selected.sampleKey}`} target="_blank" rel="noreferrer">打开原图放大核对</a><Image src={`/api/files/${selected.sampleKey}`} width={1200} height={1800} unoptimized alt="用于 Skill 生成与试识别的原始试卷" className="skill-sample" /></>}</div><div>
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
        </div></div>
      </>}
    </section>
    <div className="skill-status" aria-live="polite">{busy && <p>{busy}</p>}{error && <p role="alert" className="school-inline-error">{error}</p>}{message && <p className="skill-success">{message}</p>}</div>
  </>;
}
