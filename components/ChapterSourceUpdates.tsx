"use client";
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MathText } from './MathText';
import { studioRequest } from './KnowledgeWorkbench';
import { typeLabels } from '../lib/question-labels';
import type { ChapterSourceUpdates as Updates } from '../lib/authoring-content';
import type { QuestionWithSource } from '../lib/types';

export function ChapterSourceUpdates({url,disabled,onUpdate}:{url:string;disabled:boolean;onUpdate:(project:unknown)=>void}) {
  const [updates,setUpdates]=useState<Updates|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function inspect() {
    setBusy(true);setError('');setUpdates(null);
    try { setUpdates((await studioRequest<{updates:Updates}>(`${url}&sources=1`)).updates); }
    catch(caught) {setError(caught instanceof Error?caught.message:'读取原题更新失败');}
    finally {setBusy(false);}
  }
  async function refresh() {
    if(!updates)return;
    setBusy(true);setError('');
    try {
      const result=await studioRequest<{project:unknown}>(url,'POST',{action:'refresh-sources',revision:updates.revision,projectRevision:updates.projectRevision,expected:Object.fromEntries(updates.changes.map(change=>[change.id,change.version]))});
      onUpdate(result.project);setUpdates(null);
    } catch(caught) {setError(caught instanceof Error?caught.message:'更新原题引用失败');}
    finally {setBusy(false);}
  }
  return <section className="studio-source-updates" aria-label="原题引用更新">
    <button className="btn" disabled={disabled||busy} onClick={()=>void inspect()}>检查原题更新</button>
    <p>原题修复后，可先查看变化再更新引用，保留本章知识讲解、题序和选题理由。保存正文不会自动更新原题引用。</p>
    {error&&<p className="studio-error" role="alert">{error}</p>}
    {updates&&<>
      {!updates.changes.length?<p role="status">本章原题引用与当前题库一致。</p>:<>
        <p>发现 {updates.changes.length} 道题有变化。确认更新后，旧审校结论和采用状态撤销。原例题讲解会保留，可能需要随原题修订；请重新审校或逐项人工核对。</p>
        {updates.changes.map(change=><details key={change.id} open><summary>本章第 {change.position+1} 题{!change.after?' · 当前不可用':''}</summary>
          <div className="studio-source-comparison"><section><h4>作品引用版本</h4><SourceQuestion question={change.before}/></section><section><h4>当前题库版本</h4>{change.after?<><SourceQuestion question={change.after}/><Link href={`/review/${encodeURIComponent(change.after.source.documentId)}?question=${encodeURIComponent(change.id)}`} target="_blank" rel="noopener noreferrer">打开当前原题核对与修复</Link></>:<p>原题已移除、退出审核或不在本作品指定范围内。请在“修改正文与选题”中换题，或移除此题并保留缺口。</p>}</section></div>
        </details>)}
        <button className="btn btn-primary" disabled={disabled||busy||updates.changes.some(change=>!change.after||!change.version)} onClick={()=>void refresh()}>确认更新引用，保留章节正文</button>
      </>}
      <button className="btn" disabled={busy} onClick={()=>setUpdates(null)}>收起原题对照</button>
    </>}
  </section>;
}
function SourceQuestion({question}:{question:QuestionWithSource|null}) {
  if(!question)return <p>没有可查看的原题快照。</p>;
  return <>
    <p>{typeLabels[question.type]} · {question.source.documentName} · 原第 {question.number} 题</p>
    <p><MathText text={question.stem}/></p>
    {question.options?.map((option,index)=><p key={index}>{option.key}. <MathText text={option.content}/></p>)}
    <p><strong>答案：</strong><MathText text={question.answer||'未提供答案'}/></p>
    <p><strong>解析：</strong><MathText text={question.analysis||'未提供解析'}/></p>
    {question.assets.filter(asset=>asset.url).map(asset=><figure key={asset.id}><Image src={asset.url!} alt={asset.label||'原题配图'} width={asset.width??600} height={asset.height??400} unoptimized style={{width:'auto',height:'auto',maxWidth:'100%',maxHeight:400}}/><figcaption>{asset.role==='question'?'题目配图':'答案配图'}：{asset.label}</figcaption></figure>)}
  </>;
}
