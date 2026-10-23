"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useEducationScope } from "./AppShell";
import { KnowledgeWorkbench, studioRequest } from "./KnowledgeWorkbench";
import { AuthoringChapters } from "./AuthoringChapters";
import { AuthoringVariations } from "./AuthoringVariations";
import { AuthoringRequirements } from "./AuthoringRequirements";
import type { AuthoringRequirements as Requirements } from "../lib/authoring-requirements";
import { AuthoringModelSettings } from "./AuthoringModelSettings";
import { AuthoringSources } from "./AuthoringSources";
import { AuthoringCoverage } from "./AuthoringCoverage";
import type { WorkCoverage } from "../lib/authoring-coverage";
import type { WholePaperVariation } from "../lib/authoring-variation";
import type { AuthoringChapter } from "../lib/authoring-content";
import { difficultyLabels, type KnowledgeNode } from "../lib/knowledge-catalog";
import { planSummary, type AuthoringPlan, type AuthoringRequest } from "../lib/authoring-plan";

type Project = { requirements: Requirements | null; assumedPrerequisites: Array<{id:string;label:string}>; workCoverage: WorkCoverage | null; variation: WholePaperVariation | null; chapters: AuthoringChapter[]; paperId: string | null; id: string; title: string; kind: string; status: string; revision: number; error: string | null; request: AuthoringRequest; plan: AuthoringPlan | null; summary: { questionCount: number; totalScore: number; knowledgeCount: number } | null };
type Source = { id: string; name: string; questionCount: number };
type SourcePaper = { id:string; kind:"uploaded"|"assembled"; title:string; questionCount:number; approvedCount:number };
const isRunning = (project:Project) => ["queued","planning","generating"].includes(project.status) || project.chapters.some(chapter=>chapter.status === "running") || Boolean(project.variation?.items.some(item=>["running","accepting"].includes(item.status)));
type Coverage = Array<{ id: string; title: string; slots: Array<{ purpose: string; count: number; candidateCount: number; structureBlockedCount?:number; confirmedCount: number; difficultyMatchedCount: number; allocatedConfirmedCount: number; allocatedClassifiedCount: number; shortage: number; taggedShortage: number }> }>;
const statusLabels: Record<string, string> = { queued: "等待规划", planning: "正在规划", planned: "大纲待确认", failed: "需要处理", generating: "逐章编写中", paused: "已暂停", reviewing: "待教师核对", completed: "已完成" };
export function AuthoringStudio() {
  const scope = useEducationScope();
  return <StudioWorkspace key={`${scope.subject}:${scope.stage}`} scopeQuery={new URLSearchParams({ subject: scope.subject, stage: scope.stage }).toString()} />;
}
function StudioWorkspace({ scopeQuery }: { scopeQuery: string }) {
  const educationScope = useEducationScope();
  const [requirementsDraft, setRequirementsDraft] = useState<Requirements | null>(null);
  const [tab, setTab] = useState<"authoring" | "search">("authoring");
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]), [sources, setSources] = useState<Source[]>([]);
  const [projects, setProjects] = useState<Array<Pick<Project, "id" | "title" | "status">>>([]);
  const [models, setModels] = useState<Array<{ id: string; displayName: string }>>([]), [profileId, setProfileId] = useState("");
  const [kind, setKind] = useState<"paper" | "handout" | "book" | "variation">("handout");
  const [papers,setPapers] = useState<SourcePaper[]>([]),[paperKey,setPaperKey] = useState("");
  const [variationDifficulty,setVariationDifficulty] = useState("similar"),[reviewerProfileId,setReviewerProfileId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]), [required, setRequired] = useState<string[]>([]);
  const [project, setProject] = useState<Project | null>(null), [draft, setDraft] = useState<AuthoringPlan | null>(null);
  const [chapterDirty, setChapterDirty] = useState(false);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dirty, setDirty] = useState(false);
  async function refreshList() { const result = await studioRequest<{ projects: typeof projects; sources: Source[]; papers:SourcePaper[] }>(`/api/authoring?${scopeQuery}`); setProjects(result.projects); setSources(result.sources);setPapers(result.papers); }
  function adopt(value: Project) {
    setProject(value); setRequirementsDraft(value.requirements); setProjects(items => items.map(item => item.id === value.id ? { ...item, title: value.title, status: value.status } : item)); setDraft(value.plan); setDirty(false); setChapterDirty(false); setCoverage(null);
    setInstruction(value.request.instruction); setSourceIds(value.request.documentIds); setRequired(value.request.requiredKnowledgeIds);
    setKind(value.request.kind);setPaperKey(value.request.sourcePaperId ? `${value.request.sourcePaperKind}:${value.request.sourcePaperId}` : "");
    setVariationDifficulty(value.request.variationDifficulty);setReviewerProfileId(value.request.reviewerProfileId??"");
  }
  async function operate(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); } finally { setBusy(false); } }
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      studioRequest<{ nodes: KnowledgeNode[] }>(`/api/knowledge?${scopeQuery}`, "GET", undefined, controller.signal),
      studioRequest<{ projects: typeof projects; sources: Source[]; papers:SourcePaper[] }>(`/api/authoring?${scopeQuery}`, "GET", undefined, controller.signal),
      studioRequest<{ profiles: Array<{ id: string; displayName: string; enabled: boolean; apiKeyMask: string | null }>; selectedProfileId?: string }>("/api/model-profiles", "GET", undefined, controller.signal),
    ]).then(([catalog, library, profiles]) => { setNodes(catalog.nodes); setProjects(library.projects); setSources(library.sources);setPapers(library.papers); const available = profiles.profiles.filter(p => p.enabled && p.apiKeyMask); setModels(available); setProfileId(available.find(p => p.id === profiles.selectedProfileId)?.id ?? available[0]?.id ?? ""); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [scopeQuery]);
  const running = project && isRunning(project);
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
        setProject(result.project); setRequirementsDraft(result.project.requirements); if (result.project.plan) setDraft(result.project.plan);
        if (!isRunning(result.project)) return;
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "任务状态读取失败"); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [running, projectId, scopeQuery]);
  useEffect(() => {
    if (!dirty && !chapterDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const changeScope = (event: Event) => { if (!window.confirm("有未保存的修改。切换教学范围会丢失这些修改，确定切换吗？")) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/") || url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm("有未保存的修改。离开会丢失这些修改，确定离开吗？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); window.addEventListener("teacher-db-before-scope-change", changeScope); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); window.removeEventListener("teacher-db-before-scope-change", changeScope); document.removeEventListener("click", navigate, true); };
  }, [dirty, chapterDirty]);
  function edit(plan: AuthoringPlan) { setDraft(plan); setDirty(true); setCoverage(null); }
  return <main className="page-shell authoring-studio">
    <header className="studio-header"><div><h1>备课工作台</h1><p>从教学要求开始，确定大纲后逐章选题、编写和审校，核对后导出。</p></div><Link className="btn" href="/papers/new">手动组卷</Link></header>
    <div className="studio-topbar"><nav aria-label="备课工具"><button className={tab === "authoring" ? "active" : ""} onClick={() => setTab("authoring")}>教学规划</button><button className={tab === "search" ? "active" : ""} disabled={dirty || chapterDirty} onClick={() => setTab("search")}>精准选题与标注</button></nav><label>{tab === "authoring" ? "新作品规划与编写模型" : "题目标注模型"}<select value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">选择模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label></div>
    {!models.length && <p>尚无可用模型，可先使用检索与手动标注，或前往 <Link href="/settings/models">模型配置</Link>。</p>}
    {error && <p className="studio-error" role="alert">{error}</p>}
    {tab === "search" ? <KnowledgeWorkbench scopeQuery={scopeQuery} nodes={nodes} profileId={profileId} sources={sources} /> : <div className="studio-layout">
      <aside>
        <h2>准备什么内容</h2>
        <label>作品类型<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="paper">试卷</option><option value="variation">整卷变式</option><option value="handout">专题讲义</option><option value="book">校本 / 教辅</option></select></label>
        {kind === "variation" && <><label>选择原卷<select value={paperKey} onChange={event=>setPaperKey(event.target.value)}><option value="">选择已审核的原卷</option>{papers.map(paper=><option key={`${paper.kind}:${paper.id}`} value={`${paper.kind}:${paper.id}`} disabled={paper.approvedCount !== paper.questionCount}>{paper.kind === "uploaded" ? "上传卷" : "组卷"} · {paper.title} · {paper.questionCount} 题</option>)}</select></label>
          <label>相对原卷难度<select value={variationDifficulty} onChange={event=>setVariationDifficulty(event.target.value)}><option value="easier">降低难度</option><option value="similar">保持难度</option><option value="harder">提高难度</option></select></label></>}
        <label>新作品审校模型<select value={reviewerProfileId} onChange={event=>setReviewerProfileId(event.target.value)}><option value="">使用本次模型独立复核</option>{models.map(model=><option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label>
        <label>教学要求<textarea rows={7} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：给高三基础一般的学生做三角函数一轮复习讲义，按知识点逐步提高难度，每节有知识讲解、2 道例题和 4 道分层练习，覆盖公式、图象性质与实际应用。" /></label>
        {kind !== "variation" && <><AuthoringSources sources={sources} selected={sourceIds} onChange={setSourceIds} />
        <details><summary>必覆盖知识点（已选 {required.length} 项）</summary><div className="studio-options">{nodes.map(node => <label key={node.id}><input type="checkbox" checked={required.includes(node.id)} onChange={event => setRequired(event.target.checked ? [...required, node.id] : required.filter(id => id !== node.id))} />{node.parentId ? "　" : ""}{node.label}</label>)}</div></details>
        </>}
        <button className="btn btn-primary" disabled={busy || !profileId || instruction.trim().length < 8 || dirty || chapterDirty || kind === "variation" && !paperKey} onClick={() => void operate(async () => {
          const paper = papers.find(paper=>`${paper.kind}:${paper.id}` === paperKey);
          const result = await studioRequest<{ project: Project }>(`/api/authoring?${scopeQuery}`, "POST", { kind, instruction, documentIds: kind === "variation" ? [] : sourceIds, requiredKnowledgeIds: kind === "variation" ? [] : required, profileId, reviewerProfileId:reviewerProfileId||undefined, ...(kind === "variation" ? { sourcePaperId:paper?.id,sourcePaperKind:paper?.kind,variationDifficulty } : {}) }); adopt(result.project); await refreshList();
        })}>{busy ? "正在提交…" : kind === "variation" ? "读取原卷，确认逐题对应" : "生成教学大纲"}</button>
        <h3>最近的作品</h3><div className="studio-projects">{projects.map(item => <button key={item.id} disabled={busy || dirty || chapterDirty} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${item.id}?${scopeQuery}`)).project))}>{item.title}<small>{statusLabels[item.status] ?? item.status}</small></button>)}</div>
      </aside>
      <section className="studio-plan">
        {!project && <div className="studio-empty"><h2>把教学目标变成一份可检查的计划</h2><p>说明学生基础、范围、课时、题量和期望难度。规划会列出各章目标、例题与练习配额，再检查哪些知识点缺题。</p><p>每章保留题库来源、选题理由、知识讲解和审校结果。内容可以逐章修改、替换题目和重新生成。</p></div>}
        {running && !project.variation && <div role="status" className="studio-empty"><h2>{statusLabels[project.status]}</h2><p>任务已保存，刷新后可从最近作品继续查看。逐章编写包含选题、正文和独立审校，长讲义可以暂停并继续。</p></div>}
        {project && project.kind !== "variation" && <AuthoringModelSettings models={models} profileId={project.request.profileId ?? ""} reviewerProfileId={project.request.reviewerProfileId} disabled={busy || dirty || chapterDirty} running={Boolean(running)}
          onChange={(writerId, reviewerId) => void operate(async () => { const result = await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "POST", { action: "models", revision: project.revision, profileId: writerId, reviewerProfileId: reviewerId }); setProject(result.project); })}/>}
        {project?.variation && <AuthoringVariations project={project} scopeQuery={scopeQuery} onUpdate={value=>adopt(value as Project)}/>}
        {project?.error && <div role="alert" className="studio-error"><p>{project.error}</p><button className="btn" disabled={busy || dirty} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "POST", { action: "retry" })).project))}>重试规划</button></div>}
        {project && requirementsDraft && <>
          <AuthoringRequirements value={requirementsDraft} plan={draft} nodes={nodes} scope={educationScope} editable={!busy && !running && !project.chapters.length} onChange={value => { setRequirementsDraft({ ...value, editedByTeacher: true }); setDirty(true); setCoverage(null); }}/>
          {!draft && !running && !project.chapters.length && <button className="btn" disabled={busy || !dirty} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "PATCH", { revision: project.revision, requirements: requirementsDraft })).project))}>保存要求</button>}
        </>}
        {project?.workCoverage && <AuthoringCoverage coverage={project.workCoverage} educational={["handout","book"].includes(project.kind)}/> }
        {!!project?.assumedPrerequisites?.length && <p className="studio-assumed-knowledge">本次未安排教学、需学生已掌握的前置知识：{project.assumedPrerequisites.map(node=>node.label).join("、")}。请核对学生基础，必要时补入大纲。</p>}
        {project?.chapters.length ? <>
          <div className="studio-plan-actions"><strong>{statusLabels[project.status] ?? project.status}</strong>
            {["generating", "paused"].includes(project.status) && <button className="btn" disabled={busy || chapterDirty} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "POST", { action: project.status === "paused" ? "resume" : "pause", revision: project.revision })).project))}>{project.status === "paused" ? "继续编写" : "暂停后续生成"}</button>}
            <Link className="btn" href={`/studio/${project.id}/preview?${scopeQuery}`}>预览整份作品</Link>
            {project.status === "completed" && project.workCoverage?.ready && project.kind === "paper" && <button className="btn btn-primary" disabled={busy || chapterDirty} onClick={() => void operate(async () => { const result = await studioRequest<{ id: string }>(`/api/authoring/${project.id}?${scopeQuery}`, "POST", { action: "publish" }); window.location.assign(`/papers/${result.id}`); })}>进入组卷器与导出</button>}
            {project.status === "completed" && project.workCoverage?.ready && project.kind !== "paper" && <><a className="btn" href={`/api/authoring/${project.id}/pdf?${scopeQuery}`}>学生版 PDF</a><a className="btn" href={`/api/authoring/${project.id}/pdf?${scopeQuery}&answers=1`}>教师版 PDF</a></>}
          </div>
          <AuthoringChapters key={project.id} projectId={project.id} projectRevision={project.revision} projectStatus={project.status} chapters={project.chapters} scopeQuery={scopeQuery} documentIds={project.request.documentIds} onUpdate={value => adopt(value as Project)} onDirty={setChapterDirty} />
        </> : null}
        {draft && project && !project.chapters.length && <>
          <div className="studio-plan-actions"><span>{dirty ? "有未保存修改" : "大纲已保存"}</span><button className="btn" disabled={busy || !dirty} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "PATCH", { revision: project.revision, plan: draft, ...(requirementsDraft && JSON.stringify(requirementsDraft) !== JSON.stringify(project.requirements) ? { requirements: requirementsDraft } : {}) })).project))}>保存大纲</button><button className="btn" disabled={busy || !dirty} onClick={() => { setDraft(project.plan); setRequirementsDraft(project.requirements); setDirty(false); setCoverage(null); }}>取消修改</button><button className="btn btn-primary" disabled={busy || dirty || chapterDirty} onClick={() => void operate(async () => setCoverage((await studioRequest<{ coverage: Coverage }>(`/api/authoring/${project.id}?${scopeQuery}&coverage=1`)).coverage))}>检查题库覆盖</button><button className="btn btn-primary" disabled={busy || dirty || project.status !== "planned"} onClick={() => void operate(async () => adopt((await studioRequest<{ project: Project }>(`/api/authoring/${project.id}?${scopeQuery}`, "POST", { action: "generate", revision: project.revision })).project))}>确认大纲，逐章生成</button></div>
          <label>标题<input value={draft.title} onChange={event => edit({ ...draft, title: event.target.value })} /></label><label>适用学生<input value={draft.audience} onChange={event => edit({ ...draft, audience: event.target.value })} /></label>
          <label>预计用时（分钟）<input type="number" min={1} max={5000} value={draft.estimatedMinutes} onChange={event => edit({ ...draft, estimatedMinutes: Number(event.target.value) })}/></label>
          <p>{draft.approach}</p><p>{draft.chapters.length} 章 · {planSummary(draft).questionCount} 题 · {planSummary(draft).totalScore} 分 · 预计 {draft.estimatedMinutes} 分钟</p>
          {draft.assumptions.length > 0 && <details open><summary>需要老师核对的假设</summary><ul>{draft.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details>}
          {draft.chapters.map((chapter, index) => <article className="studio-chapter" key={chapter.id}>
            <button className="btn" disabled={busy || draft.chapters.length <= 1} onClick={() => edit({ ...draft, chapters: draft.chapters.filter((_, i) => i !== index) })}>移除第 {index + 1} 章</button>
            <label>第 {index + 1} 章<input value={chapter.title} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></label>
            <ul>{chapter.objectives.map((objective, i) => <li key={i}>{objective}</li>)}</ul><p>{chapter.knowledgeIds.map(id => nodes.find(node => node.id === id)?.label ?? id).join(" · ")}</p>
            <label>讲解与衔接要求<textarea value={chapter.teachingNotes} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, teachingNotes: event.target.value } : item) })} /></label>
            <table><thead><tr><th>用途与目标</th><th>难度</th><th>题量</th><th>每题分值</th></tr></thead><tbody>{chapter.slots.map((slot, slotIndex) => <tr key={slotIndex}><td>{({ example: "例题", practice: "练习", assessment: "检测" })[slot.role]} · {slot.purpose}<select aria-label={`第 ${index + 1} 章第 ${slotIndex + 1} 组题型`} value={slot.type} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, slots: item.slots.map((entry, j) => j === slotIndex ? { ...entry, type: event.target.value as typeof slot.type } : entry) } : item) })}>{Object.entries({any:"不限题型",single:"单选",multiple:"多选",fill:"填空",answer:"解答"}).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></td><td><select aria-label={`第 ${index + 1} 章第 ${slotIndex + 1} 组难度`} value={slot.difficulty} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, slots: item.slots.map((entry, j) => j === slotIndex ? { ...entry, difficulty: Number(event.target.value) } : entry) } : item) })}>{[1,2,3,4,5].map(level => <option key={level} value={level}>{difficultyLabels[level]}</option>)}</select></td><td><input aria-label={`第 ${index + 1} 章第 ${slotIndex + 1} 组题量`} type="number" min={1} max={30} value={slot.count} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, slots: item.slots.map((entry, j) => j === slotIndex ? { ...entry, count: Number(event.target.value) } : entry) } : item) })} /></td><td><input aria-label={`第 ${index + 1} 章第 ${slotIndex + 1} 组分值`} type="number" min={0} step="0.5" value={slot.score} onChange={event => edit({ ...draft, chapters: draft.chapters.map((item, i) => i === index ? { ...item, slots: item.slots.map((entry, j) => j === slotIndex ? { ...entry, score: Number(event.target.value) } : entry) } : item) })}/></td></tr>)}</tbody></table>
            {coverage?.find(item => item.id === chapter.id)?.slots.map((slot, i) => <p key={i} className={slot.shortage ? "studio-gap" : ""}>{slot.purpose}：需 {slot.count} 题，候选 {slot.candidateCount} 题{slot.structureBlockedCount ? `（其中 ${slot.structureBlockedCount} 题结构需修复，暂不自动选用）` : ''}，同难度已标注 {slot.difficultyMatchedCount} 题，其中教师确认 {slot.confirmedCount} 题；整份作品去重后可分配教师确认题 {slot.allocatedConfirmedCount} 道（含建议标签可分配 {slot.allocatedClassifiedCount} 道）{slot.shortage ? `；还需核对或补充 ${slot.shortage} 题` : ""}。</p>)}
          </article>)}
          {coverage && <p>可分配数量已按整份作品去重：同一题目及已识别的复制题只分配一次，题干相同但选项或题图不同的候选会保留。按知识点、题型与目标难度匹配后，正式选题仍需核对题目质量。</p>}
        </>}
      </section>
    </div>}
  </main>;
}
