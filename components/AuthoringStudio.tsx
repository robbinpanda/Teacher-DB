"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useEducationScope } from "./AppShell";
import { KnowledgeWorkbench, studioRequest } from "./KnowledgeWorkbench";
import { difficultyLabels, type KnowledgeNode } from "../lib/knowledge-catalog";
import { planSummary, type AuthoringPlan, type AuthoringRequest } from "../lib/authoring-plan";

type Project = { id: string; title: string; kind: string; status: string; revision: number; error: string | null; request: AuthoringRequest; plan: AuthoringPlan | null; summary: { questionCount: number; totalScore: number; knowledgeCount: number } | null };
type Source = { id: string; name: string; questionCount: number };
type Coverage = Array<{ id: string; title: string; slots: Array<{ purpose: string; count: number; candidateCount: number; confirmedCount: number; difficultyMatchedCount: number; shortage: number }> }>;
const statusLabels: Record<string, string> = { queued: "等待规划", planning: "正在规划", planned: "大纲待确认", failed: "需要处理" };
export function AuthoringStudio() {
  const scope = useEducationScope();
  return <StudioWorkspace key={`${scope.subject}:${scope.stage}`} scopeQuery={new URLSearchParams({ subject: scope.subject, stage: scope.stage }).toString()} />;
}
function StudioWorkspace({ scopeQuery }: { scopeQuery: string }) {
  const [tab, setTab] = useState<"authoring" | "search">("authoring");
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]), [sources, setSources] = useState<Source[]>([]);
  const [projects, setProjects] = useState<Array<Pick<Project, "id" | "title" | "status">>>([]);
  const [models, setModels] = useState<Array<{ id: string; displayName: string }>>([]), [profileId, setProfileId] = useState("");
  const [kind, setKind] = useState<"paper" | "handout" | "book">("handout");
  const [instruction, setInstruction] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]), [required, setRequired] = useState<string[]>([]);
  const [project, setProject] = useState<Project | null>(null), [draft, setDraft] = useState<AuthoringPlan | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dirty, setDirty] = useState(false);
  async function refreshList() { const result = await studioRequest<{ projects: typeof projects; sources: Source[] }>(`/api/authoring?${scopeQuery}`); setProjects(result.projects); setSources(result.sources); }
  function adopt(value: Project) {
    setProject(value); setDraft(value.plan); setDirty(false); setCoverage(null);
    setInstruction(value.request.instruction); setSourceIds(value.request.documentIds); setRequired(value.request.requiredKnowledgeIds);
    if (value.request.kind !== "variation") setKind(value.request.kind);
  }
  async function operate(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); } finally { setBusy(false); } }
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      studioRequest<{ nodes: KnowledgeNode[] }>(`/api/knowledge?${scopeQuery}`, "GET", undefined, controller.signal),
      studioRequest<{ projects: typeof projects; sources: Source[] }>(`/api/authoring?${scopeQuery}`, "GET", undefined, controller.signal),
      studioRequest<{ profiles: Array<{ id: string; displayName: string; enabled: boolean; apiKeyMask: string | null }>; selectedProfileId?: string }>("/api/model-profiles", "GET", undefined, controller.signal),
    ]).then(([catalog, library, profiles]) => { setNodes(catalog.nodes); setProjects(library.projects); setSources(library.sources); const available = profiles.profiles.filter(p => p.enabled && p.apiKeyMask); setModels(available); setProfileId(available.find(p => p.id === profiles.selectedProfileId)?.id ?? available[0]?.id ?? ""); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [scopeQuery]);
  const running = project && ["queued", "planning"].includes(project.status);
  const projectId = project?.id;
  useEffect(() => {
    if (!running || !projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const id = projectId;
    const poll = async () => {
      try {
        const result = await studioRequest<{ project: Project }>(`/api/authoring/${id}?${scopeQuery}`, "GET", undefined, controller.signal);
        if (controller.signal.aborted) return;
        setProject(result.project); if (result.project.plan) setDraft(result.project.plan);
        if (!["queued", "planning"].includes(result.project.status)) return;
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "任务状态读取失败"); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [running, projectId, scopeQuery]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function edit(plan: AuthoringPlan) { setDraft(plan); setDirty(true); setCoverage(null); }
  return <main className="page-shell authoring-studio">
    <header className="studio-header"><div><h1>备课工作台</h1><p>从教学要求开始，先确定大纲与题量，再核对题库能否支撑。</p></div><Link className="btn" href="/papers/new">手动组卷</Link></header>
    <div className="studio-topbar"><nav aria-label="备课工具"><button className={tab === "authoring" ? "active" : ""} onClick={() => setTab("authoring")}>教学规划</button><button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>精准选题与标注</button></nav><label>本次使用模型<select value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">选择模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label></div>
    {!models.length && <p>尚无可用模型，可先使用检索与手动标注，或前往 <Link href="/settings/models">模型配置</Link>。</p>}
    {error && <p className="studio-error" role="alert">{error}</p>}
    {tab === "search" ? <KnowledgeWorkbench scopeQuery={scopeQuery} nodes={nodes} profileId={profileId} /> : <div className="studio-layout">
      <aside>
        <h2>准备什么内容</h2>
        <label>作品类型<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="paper">试卷</option><option value="handout">专题讲义</option><option value="book">校本 / 教辅</option></select></label>
        <label>教学要求<textarea rows={7} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：给高三基础一般的学生做三角函数一轮复习讲义，按知识点逐步提高难度，每节有知识讲解、2 道例题和 4 道分层练习，覆盖公式、图象性质与实际应用。" /></label>
        <details><summary>选择资料范围（{sourceIds.length ? `已选 ${sourceIds.length} 份` : "整个当前题库"}）</summary><div className="studio-options">{sources.map(source => <label key={source.id}><input type="checkbox" checked={sourceIds.includes(source.id)} onChange={event => setSourceIds(event.target.checked ? [...sourceIds, source.id] : sourceIds.filter(id => id !== source.id))} />{source.name} · {source.questionCount} 题</label>)}</div></details>
        <details><summary>必覆盖知识点（已选 {required.length} 项）</summary><div className="studio-options">{nodes.map(node => <label key={node.id}><input type="checkbox" checked={required.includes(node.id)} onChange={event => setRequired(event.target.checked ? [...required, node.id] : required.filter(id => id !== node.id))} />{node.parentId ? "　" : ""}{node.label}</label>)}</div></details>
        <button className="btn btn-primary" disabled={busy || !profileId || instruction.trim().length < 8 || dirty} onClick={() => void operate(async () => {
          const result = await studioRequest<{ project: Project }>(`/api/authoring?${scopeQuery}`, "POST", { kind, instruction, documentIds: sourceIds, requiredKnowledgeIds: required, profileId }); adopt(result.project); await refreshList();
        })}>{busy ? "正在提交…" : "生成教学大纲"}</button>
        <h3>最近的作品</h3><div className="studio-projects">{projects.map(item => <button key={item.id} disabled={busy || dirty} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${item.id}?${scopeQuery}`)).project))}>{item.title}<small>{statusLabels[item.status] ?? item.status}</small></button>)}</div>
      </aside>
      <section className="studio-plan">
        {!project && <div className="studio-empty"><h2>把教学目标变成一份可检查的计划</h2><p>说明学生基础、范围、课时、题量和期望难度。规划会列出各章目标、例题与练习配额，再检查哪些知识点缺题。</p><p>当前页面完成大纲规划与选题准备；章节正文及成册导出仍在本分支开发中。</p></div>}
        {running && <div role="status" className="studio-empty"><h2>{statusLabels[project.status]}</h2><p>任务已保存，刷新后可从最近作品继续查看。</p></div>}
        {project?.error && <div role="alert" className="studio-error"><p>{project.error}</p><button className="btn" disabled={busy} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "POST", { action: "retry" })).project))}>重试规划</button></div>}
        {draft && project && <>
          <div className="studio-plan-actions"><span>{dirty ? "有未保存修改" : "大纲已保存"}</span><button className="btn" disabled={busy || !dirty} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "PATCH", { revision: project.revision, plan: draft })).project))}>保存大纲</button><button className="btn btn-primary" disabled={busy || dirty} onClick={() => void operate(async () => setCoverage((await studioRequest<{ coverage: Coverage }>(`/api/authoring/${project.id}?${scopeQuery}&coverage=1`)).coverage))}>检查题库覆盖</button></div>
          <label>标题<input value={draft.title} onChange={event => edit({ ...draft, title: event.target.value })} /></label><label>适用学生<input value={draft.audience} onChange={event => edit({ ...draft, audience: event.target.value })} /></label>
          <p>{draft.approach}</p><p>{draft.chapters.length} 章 · {planSummary(draft).questionCount} 题 · {planSummary(draft).totalScore} 分 · 预计 {draft.estimatedMinutes} 分钟</p>
          {draft.assumptions.length > 0 && <details open><summary>需要老师核对的假设</summary><ul>{draft.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
          {draft.chapters.map((chapter, index) => <article className="studio-chapter" key={chapter.id}>
            <label>第 {index + 1} 章<input value={chapter.title} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></label>
            <ul>{chapter.objectives.map((objective, i) => <li key={i}>{objective}</li>)}</ul><p>{chapter.knowledgeIds.map(id => nodes.find(node => node.id === id)?.label ?? id).join(" · ")}</p>
            <label>讲解与衔接要求<textarea value={chapter.teachingNotes} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, teachingNotes: event.target.value } : item) })} /></label>
            <table><thead><tr><th>用途与目标</th><th>难度</th><th>题量</th><th>每题分值</th></tr></thead><tbody>{chapter.slots.map((slot, slotIndex) => <tr key={slotIndex}><td>{({ example: "例题", practice: "练习", assessment: "检测" })[slot.role]} · {slot.purpose}</td><td>{difficultyLabels[slot.difficulty]}</td><td><input aria-label={`第 ${index + 1} 章第 ${slotIndex + 1} 组题量`} type="number" min={1} max={30} value={slot.count} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, slots: item.slots.map((entry, j) => j === slotIndex ? { ...entry, count: Number(event.target.value) } : entry) } : item) })} /></td><td>{slot.score}</td></tr>)}</tbody></table>
            {coverage?.find(item => item.id === chapter.id)?.slots.map((slot, i) => <p key={i} className={slot.shortage ? "studio-gap" : ""}>{slot.purpose}：需 {slot.count} 题，候选 {slot.candidateCount} 题，同难度已标注 {slot.difficultyMatchedCount} 题，其中教师确认 {slot.confirmedCount} 题{slot.shortage ? `；还需核对或补充 ${slot.shortage} 题` : ""}。</p>)}
          </article>)}
          {coverage && <p>以上是各组的候选供给，不代表已选题；同一题可能命中多组，正式选题还需要去重和逐题审阅。</p>}
        </>}
      </section>
    </div>}
  </main>;
}
