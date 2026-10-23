"use client";
import { useEffect,useState } from "react";
import type { ClassificationBatch } from "../lib/classification-batch";
import type { QuestionClassification } from "../lib/question-classification";
import { difficultyLabels,type KnowledgeNode } from "../lib/knowledge-catalog";
import { MathText } from "./MathText";
import { studioRequest } from "./KnowledgeWorkbench";
type Summary={id:string;status:string;createdAt:string;total:number;completed:number;failed:number;running:number};
type Checked={questionId:string;fingerprint:string;classification:QuestionClassification};
const labels:Record<string,string>={pending:"等待标注",running:"标注中",complete:"已生成建议",skipped:"复用有效标签",failed:"标注失败",paused:"已暂停",needs_attention:"部分题目失败"};
export function ClassificationBatches({scopeQuery,profileId,selected,nodes,onOpen,onChanged}:{scopeQuery:string;profileId:string;selected:string[];nodes:KnowledgeNode[];onOpen:(id:string)=>void;onChanged:()=>Promise<void>}) {
  const [batches,setBatches]=useState<Summary[]>([]),[batch,setBatch]=useState<ClassificationBatch|null>(null);
  const [checked,setChecked]=useState<Checked[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const batchId=batch?.id;
  const active=batches.some(item=>item.status==='running'||item.running>0);
  const adopt=(value:ClassificationBatch)=>{setBatch(value);setChecked(current=>current.filter(item=>value.items.some(row=>row.questionId===item.questionId&&row.fingerprint===item.fingerprint&&JSON.stringify(row.classification)===JSON.stringify(item.classification))));};
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{
      try {
        const result=await studioRequest<{batches:Summary[]}>(`/api/knowledge/batches?${scopeQuery}`,"GET",undefined,controller.signal);
        if(controller.signal.aborted)return;setBatches(result.batches);
        if(batchId){const result=await studioRequest<{batch:ClassificationBatch}>(`/api/knowledge/batches/${batchId}?${scopeQuery}`,"GET",undefined,controller.signal);if(!controller.signal.aborted)adopt(result.batch);}
        if(!controller.signal.aborted&&result.batches.some(item=>item.status==='running'||item.running>0))timer=setTimeout(refresh,2500);
      } catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:"读取标注进度失败");}
    };
    void refresh();return ()=>{controller.abort();clearTimeout(timer);};
  },[scopeQuery,batchId,active]);
  async function operate(action:()=>Promise<void>){setBusy(true);setError("");try{await action();setBatches((await studioRequest<{batches:Summary[]}>(`/api/knowledge/batches?${scopeQuery}`)).batches);}catch(error){setError(error instanceof Error?error.message:"标注操作失败");}finally{setBusy(false);}}
  async function action(action:"pause"|"resume"|"retry"|"confirm"){
    const result=await studioRequest<{batch:ClassificationBatch}>(`/api/knowledge/batches/${batch!.id}?${scopeQuery}`,"POST",action==='confirm'?{action,items:checked}:{action,revision:batch!.revision});adopt(result.batch);
    if(action==='confirm'){setChecked([]);await onChanged();}
  }
  return <section className="studio-classification-batches">
    <div className="studio-plan-actions"><button className="btn" disabled={busy||!profileId||selected.length===0||selected.length>200} onClick={()=>void operate(async()=>{const result=await studioRequest<{batch:ClassificationBatch}>(`/api/knowledge/batches?${scopeQuery}`,"POST",{questionIds:selected,profileId});setChecked([]);adopt(result.batch);})}>批量分析所选 {selected.length} 题</button><small>每批最多 200 题；已有有效标签自动复用，生成任务可刷新后继续查看。</small></div>
    {error&&<p className="studio-error" role="alert">{error}</p>}
    {!!batches.length&&<details><summary>最近的批量标注</summary>{batches.map(item=><p key={item.id}><button className="btn" disabled={busy} onClick={()=>void operate(async()=>{setChecked([]);adopt((await studioRequest<{batch:ClassificationBatch}>(`/api/knowledge/batches/${item.id}?${scopeQuery}`)).batch);})}>{new Date(item.createdAt).toLocaleString()} · {item.completed}/{item.total} 题完成 · {labels[item.status]??item.status}{item.failed?` · ${item.failed} 题失败`:""}</button></p>)}</details>}
    {batch&&<div className="studio-batch-review" aria-label="批量标注核对">
      <h3>逐题核对标签 · {batch.items.length} 题</h3><p>建议标签不会自动成为教师确认标签。核对考点依据、方法、能力和难度后，勾选相应题目确认。</p>
      <div className="studio-plan-actions">
        {batch.status==='running'&&<button className="btn" disabled={busy} onClick={()=>void operate(()=>action('pause'))}>当前题完成后暂停标注</button>}
        {batch.status==='paused'&&<button className="btn" disabled={busy} onClick={()=>void operate(()=>action('resume'))}>继续标注</button>}
        {batch.items.some(item=>item.status==='failed')&&<button className="btn" disabled={busy} onClick={()=>void operate(()=>action('retry'))}>重试失败题目</button>}
        <button className="btn btn-primary" disabled={busy||!checked.length} onClick={()=>void operate(()=>action('confirm'))}>确认已核对的 {checked.length} 题标签</button>
        <button className="btn" onClick={()=>{setBatch(null);setChecked([]);}}>收起批量核对</button>
      </div>
      {batch.items.map(item=><article className="studio-batch-item" key={item.id}>
        <header><label><input type="checkbox" aria-label={`确认标签 ${item.questionId}`} checked={checked.some(row=>row.questionId===item.questionId)} disabled={busy||!item.classification||!["complete","skipped"].includes(item.status)||item.classificationStatus==='confirmed'} onChange={event=>setChecked(current=>event.target.checked?[...current,{questionId:item.questionId,fingerprint:item.fingerprint,classification:item.classification!}]:current.filter(row=>row.questionId!==item.questionId))}/>{item.position+1}. {item.documentName??"题目已不可用"}</label><span>{item.classificationStatus==='confirmed'?"教师已确认":item.classificationStatus==='stale'?"标签已过期":labels[item.status]}</span></header>
        <MathText text={item.stem??"题目已删除、退回审核或移出当前范围"}/>
        {item.error&&<p className="studio-error">{item.error}</p>}
        {item.classification&&<><ul>{item.classification.knowledge.map(k=><li key={k.id}><strong>{nodes.find(n=>n.id===k.id)?.label??k.id}：</strong>{k.evidence}</li>)}</ul><p>方法：{item.classification.methods.join("、")||"未标注"} · 能力：{item.classification.competencies.join("、")||"未标注"}</p><p>难度：{difficultyLabels[item.classification.difficulty]}；{item.classification.difficultyReason}</p></>}
        {item.stem&&<button className="btn" disabled={busy} onClick={()=>onOpen(item.questionId)}>查看完整题目与修改标签{item.imageCount?`（含 ${item.imageCount} 张图）`:""}</button>}
      </article>)}
    </div>}
  </section>;
}
