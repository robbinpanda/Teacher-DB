"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MathText } from "./MathText";
import { difficultyLabels, questionCompetencies, questionMethods, type KnowledgeNode } from "../lib/knowledge-catalog";
import type { QuestionClassification } from "../lib/question-classification";
import type { RetrievalHit } from "../lib/knowledge-retrieval";
import type { QuestionWithSource } from "../lib/types";

export async function studioRequest<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: "no-store" });
  const data = await response.json().catch(() => { throw new Error(`服务响应格式异常（HTTP ${response.status}），请刷新后重试`); });
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}
type Detail = RetrievalHit & { fingerprint: string; question: QuestionWithSource };
export function KnowledgeWorkbench({ scopeQuery, nodes, profileId }: { scopeQuery: string; nodes: KnowledgeNode[]; profileId: string }) {
  const [query, setQuery] = useState("");
  const [knowledgeId, setKnowledgeId] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [result, setResult] = useState<{ hits: RetrievalHit[]; total: number; scanned: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<QuestionClassification | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function operate(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); } finally { setBusy(false); }
  }
  async function search() {
    setResult(await studioRequest(`/api/knowledge?${scopeQuery}`, "POST", { query, knowledgeIds: knowledgeId ? [knowledgeId] : undefined, difficulty: difficulty ? Number(difficulty) : undefined, confirmedOnly, limit: 100 }));
  }
  async function open(id: string) {
    const current = await studioRequest<Detail>(`/api/questions/${encodeURIComponent(id)}/classification?${scopeQuery}`);
    setDetail(current); setDraft(current.classification);
  }
  useEffect(() => {
    const controller = new AbortController();
    studioRequest<{ hits: RetrievalHit[]; total: number; scanned: number }>(`/api/knowledge?${scopeQuery}`, "POST", { limit: 30 }, controller.signal).then(setResult).catch(caught => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [scopeQuery]);
  return <section className="studio-search">
    <h2>按考点选题</h2><p>已确认标签优先；文字命中只是候选。难度是教学估计，题目修改后旧标签需要重新核对。</p>
    <form className="studio-filters" onSubmit={event => { event.preventDefault(); void operate(search); }}>
      <label>关键词<input placeholder="例如：最小正周期" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>知识点<select value={knowledgeId} onChange={event => setKnowledgeId(event.target.value)}><option value="">根据关键词识别</option>{nodes.map(node => <option key={node.id} value={node.id}>{node.parentId ? "　" : ""}{node.label}</option>)}</select></label>
      <label>难度<select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="">不限</option>{difficultyLabels.slice(1).map((label, index) => <option key={label} value={index + 1}>{index + 1} · {label}</option>)}</select></label>
      <label className="studio-check"><input type="checkbox" checked={confirmedOnly} onChange={event => setConfirmedOnly(event.target.checked)} />仅教师确认标签</label>
      <button className="btn btn-primary" disabled={busy}>检索</button>
    </form>
    {error && <p role="alert" className="studio-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {selected.length > 0 && <div className="studio-selection">已选 {selected.length} 题 <Link className="btn btn-primary" href={`/papers/new?ids=${encodeURIComponent(selected.join(","))}`}>进入组卷</Link><button className="btn" onClick={() => setSelected([])}>清空选择</button></div>}
    {result && <p>{result.total} 道匹配题目 · 已检索当前范围 {result.scanned} 道题{result.total > result.hits.length ? `，显示前 ${result.hits.length} 道，请细化条件` : ""}</p>}
    <div className="studio-results">{result?.hits.map(hit => <article key={hit.id}>
      <header><label><input type="checkbox" aria-label={`选择题目 ${hit.id}`} checked={selected.includes(hit.id)} onChange={event => setSelected(current => event.target.checked ? [...current, hit.id] : current.filter(id => id !== hit.id))} /> {hit.documentName}</label><span>{hit.classification ? `${difficultyLabels[hit.classification.difficulty]} · ${hit.classificationStatus === "confirmed" ? "已确认" : "模型建议"}` : hit.classificationStatus === "stale" ? "标签已过期" : "待标注"}</span></header>
      <MathText text={hit.stem} /><ul>{hit.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      <button className="btn" disabled={busy} onClick={() => void operate(() => open(hit.id))}>查看题目与标签</button>
    </article>)}</div>
    {result?.total === 0 && <div className="studio-empty">没有符合条件的题目。可以取消“仅教师确认”、调整难度，或先导入相关资料。</div>}
    {detail && <div className="studio-detail" role="region" aria-label="题目标注">
      <header><h2>核对题目与标签</h2><button className="btn" disabled={busy} onClick={() => { setDetail(null); setDraft(null); }}>关闭</button></header>
      <MathText text={detail.question.stem} />{detail.question.options?.map(option => <p key={option.key}>{option.key}. <MathText text={option.content} /></p>)}
      {detail.question.assets.filter(asset => asset.url).map(asset => <Image key={asset.id} src={asset.url!} alt={asset.label} width={asset.width ?? 800} height={asset.height ?? 600} unoptimized style={{ width: "auto", height: "auto" }} />)}
      <p><strong>答案：</strong><MathText text={detail.question.answer} /></p><p><strong>解析：</strong><MathText text={detail.question.analysis} /></p>
      <button className="btn" disabled={busy || !profileId || detail.classificationStatus === "confirmed"} onClick={() => void operate(async () => {
        await studioRequest(`/api/questions/${encodeURIComponent(detail.id)}/classification?${scopeQuery}`, "POST", { profileId }); await open(detail.id); await search();
      })}>{busy ? "处理中…" : "AI 分析考点和难度"}</button>
      {!draft && <button className="btn" disabled={busy} onClick={() => setDraft({ knowledge: [], methods: [], competencies: [], difficulty: 2, difficultyReason: "", prerequisites: [], confidence: 1 })}>手动标注</button>}
      {draft && <div className="studio-tag-editor">
        <h3>考点及依据</h3>{draft.knowledge.map((item, index) => <div className="studio-tag-row" key={`${item.id}-${index}`}>
          <select aria-label={`考点 ${index + 1}`} value={item.id} onChange={event => setDraft({ ...draft, knowledge: draft.knowledge.map((entry, i) => i === index ? { ...entry, id: event.target.value } : entry) })}>{nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
          <input aria-label={`考点依据 ${index + 1}`} value={item.evidence} onChange={event => setDraft({ ...draft, knowledge: draft.knowledge.map((entry, i) => i === index ? { ...entry, evidence: event.target.value } : entry) })} />
          <button className="btn" onClick={() => setDraft({ ...draft, knowledge: draft.knowledge.filter((_, i) => i !== index) })}>移除</button>
        </div>)}
        <button className="btn" disabled={draft.knowledge.length >= 12} onClick={() => { const next = nodes.find(node => !draft.knowledge.some(item => item.id === node.id)); if (next) setDraft({ ...draft, knowledge: [...draft.knowledge, { id: next.id, evidence: "" }] }); }}>增加考点</button>
        <fieldset><legend>解题方法</legend>{questionMethods.map(method => <label key={method}><input type="checkbox" checked={draft.methods.includes(method)} onChange={event => setDraft({ ...draft, methods: event.target.checked ? [...draft.methods, method] : draft.methods.filter(value => value !== method) })} />{method}</label>)}</fieldset>
        <fieldset><legend>能力</legend>{questionCompetencies.map(item => <label key={item}><input type="checkbox" checked={draft.competencies.includes(item)} onChange={event => setDraft({ ...draft, competencies: event.target.checked ? [...draft.competencies, item] : draft.competencies.filter(value => value !== item) })} />{item}</label>)}</fieldset>
        <label>难度<select value={draft.difficulty} onChange={event => setDraft({ ...draft, difficulty: Number(event.target.value) })}>{difficultyLabels.slice(1).map((label, i) => <option key={label} value={i + 1}>{i + 1} · {label}</option>)}</select></label>
        <label>难度依据<textarea value={draft.difficultyReason} onChange={event => setDraft({ ...draft, difficultyReason: event.target.value })} /></label>
        <button className="btn btn-primary" disabled={busy} onClick={() => void operate(async () => {
          await studioRequest(`/api/questions/${encodeURIComponent(detail.id)}/classification?${scopeQuery}`, "PATCH", { fingerprint: detail.fingerprint, classification: draft });
          await open(detail.id); await search(); setNotice("标签已确认，可用于按难度和知识点筛题。");
        })}>保存并确认标签</button>
      </div>}
    </div>}
  </section>;
}
