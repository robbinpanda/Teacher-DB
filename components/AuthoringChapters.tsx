"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { MathText } from "./MathText";
import { ChapterHistory } from "./ChapterHistory";
import { ChapterPlanFields } from "./ChapterPlanFields";
import { studioRequest } from "./KnowledgeWorkbench";
import type { AuthoringChapter, SavedChapterContent, AuthoringChapterVersion } from "../lib/authoring-content";
import type { RetrievalHit } from "../lib/knowledge-retrieval";
import type { QuestionWithSource } from "../lib/types";

const labels: Record<AuthoringChapter["status"], string> = { pending: "等待处理", running: "正在选题、编写与审校", complete: "模型未发现问题，待核对", needs_review: "有缺口或审校问题", failed: "处理失败", approved: "教师已采用" };
export function AuthoringChapters({ projectId, projectRevision, projectStatus, chapters, scopeQuery, documentIds, onUpdate, onDirty }: {
  projectId: string; projectRevision: number; projectStatus: string; chapters: AuthoringChapter[]; scopeQuery: string; documentIds: string[];
  onUpdate: (project: unknown) => void; onDirty: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState(chapters[0]?.id ?? ""), [dirty, setDirty] = useState(false);
  const active = chapters.find(chapter => chapter.id === selected) ?? chapters[0];
  if (!active) return null;
  return <section className="studio-generated"><h2>章节内容</h2><p>{chapters.filter(chapter => chapter.status === "approved").length} / {chapters.length} 章已采用。核对全部章节后可导出正式作品。</p>
    <nav aria-label="章节目录">{chapters.map(chapter => <button type="button" className={chapter.id === active.id ? "active" : ""} disabled={dirty && chapter.id !== active.id} key={chapter.id} onClick={() => setSelected(chapter.id)}>{chapter.position + 1}. {chapter.plan.title}<small>{labels[chapter.status]}</small></button>)}</nav>
    <ChapterEditor key={`${active.id}:${active.revision}`} chapter={active} projectId={projectId} projectRevision={projectRevision} projectStatus={projectStatus} scopeQuery={scopeQuery} documentIds={documentIds} onUpdate={onUpdate} onDirty={value => { setDirty(value); onDirty(value); }} />
  </section>;
}
function ChapterEditor({ chapter, projectId, projectRevision, projectStatus, scopeQuery, documentIds, onUpdate, onDirty }: {
  chapter: AuthoringChapter; projectId: string; projectRevision: number; projectStatus: string; scopeQuery: string; documentIds: string[];
  onUpdate: (project: unknown) => void; onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(chapter.content), [editing, setEditing] = useState(false), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const [planning, setPlanning] = useState(false), [planDraft, setPlanDraft] = useState(chapter.plan);
  const [historical, setHistorical] = useState<AuthoringChapterVersion | null>(null);
  const [lookup, setLookup] = useState<{ slot: number; replace: number | null } | null>(null), [query, setQuery] = useState(""), [hits, setHits] = useState<RetrievalHit[]>([]);
  const url = `/api/authoring/${projectId}/chapters/${chapter.id}?${scopeQuery}`;
  const working = ["pending", "running"].includes(chapter.status);
  // The parent's stable dirty callback is retained for cleanup without retriggering edits.
  const [notifyDirty] = useState(() => onDirty);
  useEffect(() => () => notifyDirty(false), [notifyDirty]);
  function edit(value: SavedChapterContent) { setDraft(value); setDirty(true); notifyDirty(true); }
  async function operate(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); } finally { setBusy(false); } }
  async function action(name: "retry" | "review" | "revise" | "approve") {
    const result = await studioRequest<{ project: unknown }>(url, "POST", { action: name, revision: chapter.revision, note });
    onUpdate(result.project);
  }
  async function findQuestions(slot: number, replace: number | null) {
    setLookup({ slot, replace });
    const target = chapter.plan.slots[slot];
    const result = await studioRequest<{ hits: RetrievalHit[] }>(`/api/knowledge?${scopeQuery}`, "POST", { query, knowledgeIds: target.knowledgeIds, match: "all", types: target.type === "any" ? undefined : [target.type],
      documentIds: documentIds.length ? documentIds : undefined, excludeIds: draft?.items.map(item => item.questionId), limit: 30 });
    setHits(result.hits);
  }
  return <article className="studio-chapter-content">
    <header><h3>{chapter.position + 1}. {chapter.plan.title}</h3><span>{labels[chapter.status]}</span></header>
    {draft?.review.modelDisplayName && <p className="studio-review-model">本次审校模型：{draft.review.modelDisplayName}</p>}
    {chapter.error && <p className="studio-error" role="alert">{chapter.error}</p>}{error && <p className="studio-error" role="alert">{error}</p>}
    {working && <p role="status">本章第 {chapter.attempt || 1} 次处理。进度保存在后台，可以刷新后继续查看。</p>}
    {!!chapter.history?.length && <ChapterHistory history={chapter.history} version={historical} busy={busy} canRestore={!dirty && projectStatus !== "generating" && chapter.status !== "running" && (chapter.status !== "pending" || projectStatus === "paused")}
      onView={versionId => void operate(async () => { const result = await studioRequest<{ version: AuthoringChapterVersion }>(`${url}&version=${versionId}`); setHistorical(result.version); })}
      onClose={() => setHistorical(null)} onRestore={versionId => void operate(async () => { const result = await studioRequest<{ project: unknown }>(url, "POST", { action: "restore", revision: chapter.revision, projectRevision, versionId }); onUpdate(result.project); })}/>}
    {!working && <div className="studio-plan-actions">
      <button className="btn" disabled={busy || dirty || projectStatus === "generating"} onClick={()=>{setPlanning(true);setEditing(false);setDirty(true);notifyDirty(true);}}>调整本章计划</button>
      <button className="btn" disabled={busy || dirty || projectStatus === "paused"} onClick={() => { if (!draft || window.confirm("重新生成会替换本章当前内容，其他章节会保留。继续吗？")) void operate(() => action("retry")); }}>重新生成本章</button>
    {draft && <>{!draft.review.passed && <button className="btn btn-primary" disabled={busy || dirty || projectStatus === "paused"} onClick={() => void operate(() => action("revise"))}>按审校意见修订正文</button>}<button className="btn" disabled={busy || dirty || projectStatus === "paused"} onClick={() => void operate(() => action("review"))}>重新审校</button>
        <button className="btn" disabled={busy || planning || projectStatus === "generating"} onClick={() => setEditing(!editing)}>{editing ? "收起编辑" : "修改正文与选题"}</button>
        <button className="btn btn-primary" disabled={busy || planning || !dirty} onClick={() => void operate(async () => { const result = await studioRequest<{ project: unknown }>(url, "PATCH", { revision: chapter.revision, content: draft }); setDirty(false); notifyDirty(false); onUpdate(result.project); })}>保存本章修改</button></>}
    </div>}
    {planning && <section className="studio-replacement"><h4>调整本章计划</h4><p>保存后仅重新选题、编写与审校本章；其他章节保留。本章当前正文会存入历史版本，采用状态撤销。</p>
      <ChapterPlanFields plan={planDraft} onChange={setPlanDraft}/>
      <div className="studio-plan-actions"><button className="btn btn-primary" disabled={busy} onClick={()=>void operate(async()=>{const result=await studioRequest<{project:unknown}>(url,"POST",{action:"replan",revision:chapter.revision,projectRevision,plan:planDraft});setPlanning(false);setDirty(false);notifyDirty(false);onUpdate(result.project);})}>保存计划并重做本章</button>
      <button className="btn" disabled={busy} onClick={()=>{setPlanning(false);setPlanDraft(chapter.plan);setDirty(false);notifyDirty(false);}}>取消计划修改</button></div>
    </section>}
    {draft && <>
      {draft.review.checks?.length ? <details className="studio-review-checks"><summary>逐项学科核查（{draft.review.checks.filter(check => check.passed).length} / {draft.review.checks.length} 项通过）</summary>{draft.review.checks.map(check => <section key={check.id}><p><strong>{check.passed ? "通过" : "需修正"}：</strong><MathText text={check.reason}/></p><details><summary>查看原文依据</summary><blockquote><MathText text={check.evidence}/></blockquote></details></section>)}</details> : null}
      {draft.gaps.length > 0 && <div className="studio-error"><strong>尚未满足题量</strong>{draft.gaps.map(gap => <p key={gap.slotIndex}>第 {gap.slotIndex + 1} 组：{gap.reason}</p>)}</div>}
      {!draft.review.passed && <div className="studio-error"><strong>待核对的问题</strong><ul>{draft.review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>}
      {draft.selectionAudit && <details><summary>自动选题比较记录（{draft.selectionAudit.rounds} 批）</summary><p>只对已展示给模型的候选做了比较；题量满足后停止补查。教师修改内容不会改写这次记录。</p><ul>{draft.selectionAudit.slots.map(slot => <li key={slot.slotIndex}>第 {slot.slotIndex + 1} 组：符合检索条件 {slot.eligible} 道，已比较 {slot.compared} 道，尚未比较 {slot.remaining} 道。</li>)}</ul></details>}
      {!!draft.review.suggestions?.length && <details className="studio-review-suggestions"><summary>可选教学建议（不影响审校结论）</summary><ul>{draft.review.suggestions.map((suggestion,index)=><li key={index}><MathText text={suggestion}/></li>)}</ul></details>}
      {editing ? <label>导入说明<textarea value={draft.introduction} onChange={event => edit({ ...draft, introduction: event.target.value })} /></label> : <p><MathText text={draft.introduction} /></p>}
      {draft.knowledge.map((knowledge, index) => <section className="studio-knowledge-body" key={knowledge.id}>
        <h4>{knowledge.title}</h4>
        {editing ? <label>知识讲解<textarea rows={7} value={knowledge.explanation} onChange={event => edit({ ...draft, knowledge: draft.knowledge.map((item, i) => i === index ? { ...item, explanation: event.target.value } : item) })} /></label> : <p><MathText text={knowledge.explanation} /></p>}
        {knowledge.formulas.map((formula, fi) => editing ? <div key={fi} className="studio-formula-editor"><label>公式（LaTeX）<input value={formula.latex} onChange={event => edit({ ...draft, knowledge: draft.knowledge.map((item, i) => i === index ? { ...item, formulas: item.formulas.map((entry, j) => j === fi ? { ...entry, latex: event.target.value } : entry) } : item) })} /></label><label>适用条件<input value={formula.conditions} onChange={event => edit({ ...draft, knowledge: draft.knowledge.map((item, i) => i === index ? { ...item, formulas: item.formulas.map((entry, j) => j === fi ? { ...entry, conditions: event.target.value } : entry) } : item) })} /></label></div> : <p key={fi}><MathText text={`$${formula.latex}$`} /><br />适用条件：<MathText text={formula.conditions} /></p>)}
        {editing ? <label>解题方法<textarea value={knowledge.method} onChange={event => edit({ ...draft, knowledge: draft.knowledge.map((item, i) => i === index ? { ...item, method: event.target.value } : item) })} /></label> : <p><strong>方法：</strong><MathText text={knowledge.method} /></p>}
        {knowledge.misconceptions.map((entry, mi) => editing ? <div key={mi}><label>常见误区<input value={entry.mistake} onChange={event => edit({ ...draft, knowledge: draft.knowledge.map((item, i) => i === index ? { ...item, misconceptions: item.misconceptions.map((value, j) => j === mi ? { ...value, mistake: event.target.value } : value) } : item) })} /></label><label>纠正与解释<textarea value={entry.correction} onChange={event => edit({ ...draft, knowledge: draft.knowledge.map((item, i) => i === index ? { ...item, misconceptions: item.misconceptions.map((value, j) => j === mi ? { ...value, correction: event.target.value } : value) } : item) })} /></label></div> : <p key={mi}><strong>易错：</strong>{entry.mistake}<br /><strong>纠正：</strong><MathText text={entry.correction} /></p>)}
      </section>)}
      {draft.items.map((item, index) => {
        const question = draft.questions.find(question => question.id === item.questionId), slot = chapter.plan.slots[item.slotIndex];
        return <section className="studio-selected-question" key={`${index}:${item.questionId}`}>
          <h4>{slot.role === "example" ? "例题" : slot.role === "practice" ? "练习" : "检测"} {index + 1}</h4>
          {question && <><p><MathText text={question.stem} /></p>{question.options?.map(option => <p key={option.key}>{option.key}. <MathText text={option.content} /></p>)}
            {question.assets.filter(asset => asset.url).map(asset => <Image key={asset.id} src={asset.url!} alt={asset.label} width={asset.width ?? 600} height={asset.height ?? 400} unoptimized style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: 400 }} />)}
            <small>来源：{question.source.documentName} · 原第 {question.number} 题</small><p><strong>题库答案：</strong><MathText text={question.answer} /></p></>}
          {editing ? <><label>选题理由<textarea value={item.selectionReason} onChange={event => edit({ ...draft, items: draft.items.map((entry, i) => i === index ? { ...entry, selectionReason: event.target.value } : entry) })} /></label><label>讲解与方法总结<textarea rows={6} value={item.teachingExplanation} onChange={event => edit({ ...draft, items: draft.items.map((entry, i) => i === index ? { ...entry, teachingExplanation: event.target.value } : entry) })} /></label><button className="btn" disabled={busy} onClick={() => void operate(() => findQuestions(item.slotIndex, index))}>替换这道题</button></>
            : <><p><strong>选入理由：</strong>{item.selectionReason}</p><p><MathText text={item.teachingExplanation || question?.analysis || ""} /></p></>}
        </section>;
      })}
      {editing && draft.gaps.map(gap => <button className="btn" disabled={busy} key={gap.slotIndex} onClick={() => void operate(() => findQuestions(gap.slotIndex, null))}>为第 {gap.slotIndex + 1} 组补题</button>)}
      {editing && lookup && <div className="studio-replacement"><h4>选择替换或补充题目</h4><label>补充关键词<input value={query} onChange={event => setQuery(event.target.value)} /></label><button className="btn" disabled={busy} onClick={() => void operate(() => findQuestions(lookup.slot, lookup.replace))}>查找候选</button>
        {hits.length === 0 && <p>指定资料中没有找到候选，请导入相关题目后重新生成本章。</p>}
        {hits.map(hit => <article key={hit.id}><MathText text={hit.stem} /><p>{hit.documentName}</p><button className="btn" disabled={busy} onClick={() => void operate(async () => {
          const result = await studioRequest<{ question: QuestionWithSource }>(`/api/questions/${hit.id}/classification?${scopeQuery}`);
          const replacement = { slotIndex: lookup.slot, questionId: hit.id, selectionReason: "", teachingExplanation: result.question.analysis };
          const items = lookup.replace === null ? [...draft.items, replacement] : draft.items.map((item, i) => i === lookup.replace ? replacement : item);
          const gaps = draft.gaps.filter(gap => items.filter(item => item.slotIndex === gap.slotIndex).length < chapter.plan.slots[gap.slotIndex].count);
          edit({ ...draft, items, gaps, questions: [...draft.questions, result.question] }); setLookup(null);
        })}>选用并填写理由</button></article>)}</div>}
      {editing ? <label>本章小结<textarea value={draft.conclusion} onChange={event => edit({ ...draft, conclusion: event.target.value })} /></label> : <p><strong>本章小结：</strong><MathText text={draft.conclusion} /></p>}
      {!working && chapter.status !== "approved" && <div className="studio-approval"><label>人工核对说明{!draft.review.passed && "（请说明如何处理上面的审校问题）"}<textarea disabled={busy || working} value={note} onChange={event => setNote(event.target.value)} /></label><button className="btn btn-primary" disabled={busy || dirty || !["complete", "needs_review"].includes(chapter.status) || draft.gaps.length > 0 || !draft.review.passed && note.trim().length < 10} onClick={() => void operate(() => action("approve"))}>已核对，采用本章</button></div>}
    </>}
  </article>;
}
