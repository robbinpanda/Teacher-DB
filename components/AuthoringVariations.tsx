"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { MathText } from "./MathText";
import { studioRequest } from "./KnowledgeWorkbench";
import type { WholePaperVariation, WholePaperVariationItem } from "../lib/authoring-variation";

const labels: Record<string,string> = { pending:"等待生成", running:"正在命题与审校", awaiting_teacher:"待核对采用", accepting:"正在采用", accepted:"已采用", failed:"需要重试" };
type Project = { id:string; status:string; revision:number; variation:WholePaperVariation|null };
export function AuthoringVariations({project,scopeQuery,onUpdate}:{project:Project;scopeQuery:string;onUpdate:(project:unknown)=>void}) {
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const items = project.variation!.items, completed = items.filter(item=>item.status === "accepted").length;
  async function act(action:string) {
    setBusy(true);setError("");
    try {
      if (action === "publish") { const result = await studioRequest<{id:string}>(`/api/authoring/${project.id}?${scopeQuery}`,"POST",{action}); window.location.assign(`/papers/${result.id}`); }
      else onUpdate((await studioRequest<{project:unknown}>(`/api/authoring/${project.id}?${scopeQuery}`,"POST",{action,revision:project.revision})).project);
    } catch(error) { setError(error instanceof Error?error.message:"操作失败"); } finally { setBusy(false); }
  }
  return <section className="studio-variations"><h2>{project.variation!.sourceTitle} · 整卷变式</h2>
    <p>{items.length} 题 · {items.reduce((sum,item)=>sum+item.score,0)} 分 · 已采用 {completed}/{items.length}。题型、题号和分值按原卷保留，每题经独立审校后由老师核对采用。</p>
    {items.some(item=>!item.score) && <p>部分原题未保存分值，当前按 0 分保留；可在导出前进入组卷器补齐。</p>}
    <div className="studio-plan-actions">
      {project.status === "planned" && <button className="btn btn-primary" disabled={busy} onClick={()=>void act("generate")}>确认原卷，逐题生成</button>}
      {project.status === "generating" && <button className="btn" disabled={busy} onClick={()=>void act("pause")}>当前题完成后暂停</button>}
      {project.status === "paused" && <button className="btn" disabled={busy} onClick={()=>void act("resume")}>继续生成</button>}
      {completed === items.length && <button className="btn btn-primary" disabled={busy} onClick={()=>void act("publish")}>进入组卷器与导出变式卷</button>}
    </div>
    {error && <p role="alert" className="studio-error">{error}</p>}
    {items.map(item=><VariationItem key={`${item.id}:${item.revision}`} item={item} projectId={project.id} scopeQuery={scopeQuery} onUpdate={onUpdate} />)}
  </section>;
}
function VariationItem({item,projectId,scopeQuery,onUpdate}:{item:WholePaperVariationItem;projectId:string;scopeQuery:string;onUpdate:(project:unknown)=>void}) {
  const [busy,setBusy] = useState(false),[error,setError] = useState("");
  const [open,setOpen] = useState(false),[diagram,setDiagram] = useState<string|null>(null);
  const url = `/api/authoring/${projectId}/variations/${item.id}?${scopeQuery}`;
  useEffect(()=> {
    if (!open || !item.candidate?.question.diagram) return;
    const controller = new AbortController();
    studioRequest<{run:{candidates:Array<{diagramPreviewUrl:string|null}>}|null}>(url,"GET",undefined,controller.signal).then(result=>setDiagram(result.run?.candidates[0]?.diagramPreviewUrl??null)).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[open,item.candidate?.question.diagram,url]);
  async function act(action:"accept"|"retry") {
    setBusy(true);setError("");
    try { onUpdate((await studioRequest<{project:unknown}>(url,"POST",{action,revision:item.revision})).project); }
    catch(error) { setError(error instanceof Error?error.message:"操作失败"); } finally { setBusy(false); }
  }
  const candidate = item.candidate;
  return <details className="studio-chapter" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>第 {item.number} 题 · {item.score} 分 · {labels[item.status]}{candidate?.review?.score != null ? ` · 审校 ${candidate.review.score} 分` : ""}</summary>
    {open && <><div className="studio-variation-comparison">
      <section><h3>原题 · {item.sectionTitle}</h3><MathText text={item.source.stem} />{item.source.options?.map(option=><div key={option.key}>{option.key}. <MathText text={option.content}/></div>)}
        {item.source.assets.filter(asset=>asset.role === "question" && asset.url).map(asset=><Image key={asset.id} src={asset.url!} width={720} height={480} unoptimized alt={asset.label||"原题题图"} style={{maxWidth:"100%",height:"auto"}}/>)}
        <details><summary>原题答案与解析</summary><MathText text={item.source.answer}/><MathText text={item.source.analysis}/></details>
      </section>
      <section><h3>变式题</h3>{candidate ? <><MathText text={candidate.question.stem}/>{candidate.question.options?.map(option=><div key={option.key}>{option.key}. <MathText text={option.content}/></div>)}
        {diagram && <Image src={diagram} width={720} height={480} alt="变式题题图" unoptimized style={{maxWidth:"100%",height:"auto"}}/>}
        <p>改编说明：{candidate.question.changeNote}</p><h4>答案与解析</h4><MathText text={candidate.question.answer}/><MathText text={candidate.question.analysis}/>
        {candidate.review?.issues.length>0 && <ul>{candidate.review.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
      </> : <p>{labels[item.status]}。结果会自动保存，可稍后回来查看。</p>}</section>
    </div>
    {(error || item.error) && <p role="alert" className="studio-error">{error||item.error}</p>}
    <div className="studio-plan-actions">{item.status === "awaiting_teacher" && <button className="btn btn-primary" disabled={busy || Boolean(candidate?.question.diagram && !diagram)} onClick={()=>void act("accept")}>核对完成，采用此题</button>}
      {["failed","awaiting_teacher","accepted"].includes(item.status) && <button className="btn" disabled={busy} onClick={()=>void act("retry")}>重新生成此题</button>}</div>
    </>}
  </details>;
}
