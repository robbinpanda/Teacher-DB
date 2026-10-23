import { matchQuestions, type RetrievalRow, type RetrievalHit } from './knowledge-retrieval.ts';
import type { EducationScope } from './education-scope.ts';
import type { AuthoringChapterPlan } from './authoring-plan.ts';
import { z } from 'zod';

type Slot = AuthoringChapterPlan['slots'][number];
type Selection = { items: Array<{slotIndex:number;questionId:string;selectionReason:string}>; gaps:Array<{slotIndex:number;reason:string}> };
const stemKey = (stem:string) => stem.normalize('NFKC').replace(/[\s$\\{}]/g,'');

/** Preserve evidence priority, but prevent one source dominating an equal-score batch. */
export function diversifyCandidates(hits: RetrievalHit[]) {
  const tiers = new Map<number, Map<string, RetrievalHit[]>>();
  for (const hit of hits) {
    const sources = tiers.get(hit.score) ?? new Map<string, RetrievalHit[]>();
    const group = sources.get(hit.documentId) ?? []; group.push(hit); sources.set(hit.documentId,group); tiers.set(hit.score,sources);
  }
  const result: RetrievalHit[] = [], stems = new Set<string>();
  for (const [,sources] of [...tiers].sort(([a],[b])=>b-a)) {
    const groups = [...sources.values()];
    for (let index=0; groups.some(group=>index<group.length); index++) for (const group of groups) {
      const hit=group[index]; if (!hit || stems.has(stemKey(hit.stem))) continue;
      stems.add(stemKey(hit.stem)); result.push(hit);
    }
  }
  return result;
}

export function chapterCandidateLists(rows:RetrievalRow[],scope:EducationScope,slots:Slot[]) {
  const cache = new Map<string,RetrievalHit[]>();
  return slots.map(slot=>{
    const key=JSON.stringify([slot.knowledgeIds,slot.type]);
    let hits=cache.get(key);
    if(!hits){hits=matchQuestions(rows,scope,{knowledgeIds:slot.knowledgeIds,match:'all',types:slot.type==='any'?undefined:[slot.type]}).hits;cache.set(key,hits);}
    // A valid assessed difficulty cannot be overridden by the unfiltered fallback.
    // Stale/unknown labels remain candidates for explicit model/teacher judgement.
    return diversifyCandidates(hits.filter(hit=>!hit.classification || hit.classification.difficulty===slot.difficulty));
  });
}

export type SelectionAudit = { rounds:number; traceIds:string[]; slots:Array<{slotIndex:number;eligible:number;compared:number;remaining:number}> };
export const selectionCheckpointSchema=z.object({
  version:z.literal(1), positions:z.array(z.number().int().nonnegative()).max(30), sizes:z.array(z.number().int().nonnegative()).max(30),
  seen:z.array(z.array(z.string().min(1).max(100))).max(30), rounds:z.number().int().nonnegative(), traceIds:z.array(z.string()), finished:z.boolean(),
  selection:z.object({items:z.array(z.object({slotIndex:z.number().int().nonnegative(),questionId:z.string(),selectionReason:z.string()})).max(30),gaps:z.array(z.object({slotIndex:z.number().int().nonnegative(),reason:z.string()})).max(30)}),
  resetReason:z.string().optional(),
});
export type SelectionCheckpoint=z.infer<typeof selectionCheckpointSchema>;
export function selectionCheckpointAudit(state:SelectionCheckpoint):SelectionAudit {
  return {rounds:state.rounds,traceIds:state.traceIds,slots:state.sizes.map((eligible,slotIndex)=>({slotIndex,eligible,compared:state.seen[slotIndex].length,remaining:eligible-state.seen[slotIndex].length}))};
}
export function validateSelectionCheckpoint(value:unknown,lists:RetrievalHit[][],slots:Slot[]) {
  const state=selectionCheckpointSchema.parse(value);
  if([state.positions.length,state.sizes.length,state.seen.length].some(size=>size!==slots.length)||state.traceIds.length>state.rounds)throw new Error('选题检查点结构不一致');
  const ids=new Set<string>(),selectedIds=new Set(state.selection.items.map(item=>item.questionId)),gapIds=new Set(state.selection.gaps.map(gap=>gap.slotIndex));
  if(gapIds.size!==state.selection.gaps.length||[...gapIds].some(index=>!slots[index]))throw new Error('选题检查点缺口无效');
  slots.forEach((slot,index)=>{
    const allowed=new Set(lists[index].map(hit=>hit.id)),seen=new Set(state.seen[index]);
    if(state.sizes[index]!==lists[index].length||state.positions[index]>lists[index].length||seen.size!==state.seen[index].length||[...seen].some(id=>!allowed.has(id))||lists[index].slice(0,state.positions[index]).some(hit=>!seen.has(hit.id)&&!selectedIds.has(hit.id)))throw new Error('选题检查点候选范围已变化');
    const items=state.selection.items.filter(item=>item.slotIndex===index);
    if(items.length>slot.count||gapIds.has(index)!==(items.length<slot.count))throw new Error('选题检查点配额不一致');
  });
  for(const item of state.selection.items){if(!slots[item.slotIndex]||ids.has(item.questionId)||!state.seen[item.slotIndex].includes(item.questionId))throw new Error('选题检查点暂选题无效');ids.add(item.questionId);}
  if(state.finished&&state.selection.gaps.some(gap=>state.positions[gap.slotIndex]<lists[gap.slotIndex].length||lists[gap.slotIndex].some(hit=>selectedIds.has(hit.id)&&!state.seen[gap.slotIndex].includes(hit.id))))throw new Error('选题检查点尚未完成比较');
  return state;
}
export function selectionProgressFromJson(value:string|null,updatedAt:string|null) {
  if(!value)return undefined;
  try{const state=selectionCheckpointSchema.parse(JSON.parse(value));const audit=selectionCheckpointAudit(state);return {...audit,selected:state.selection.items.length,finished:state.finished,resetReason:state.resetReason,updatedAt};}catch{return undefined;}
}

/** Expand only while quotas remain missing; never confuse a truncated first batch with absence. */
export async function selectCandidateBatches(
  lists:RetrievalHit[][], slots:Slot[],
  compare:(pools:string[][],previous:Selection,round:number)=>Promise<Selection & {traceId?:string}>,
  options:{resume?:SelectionCheckpoint;onCheckpoint?:(state:SelectionCheckpoint)=>void|Promise<void>;beforeBatch?:()=>void;resetReason?:string}={},
) {
  const resume=options.resume?validateSelectionCheckpoint(structuredClone(options.resume),lists,slots):undefined;
  const positions=resume?.positions??slots.map(()=>0), seen=resume?.seen.map(ids=>new Set(ids))??slots.map(()=>new Set<string>());
  let selection:Selection=resume?.selection??{items:[],gaps:slots.map((_,slotIndex)=>({slotIndex,reason:'当前教学范围与题型、考点、已标注难度条件下没有可用候选。'}))};
  let rounds=resume?.rounds??0;const traceIds:string[]=resume?.traceIds??[];
  const snapshot=(finished:boolean):SelectionCheckpoint=>({version:1,positions:[...positions],sizes:lists.map(list=>list.length),seen:seen.map(ids=>[...ids]),rounds,traceIds:[...traceIds],selection:structuredClone(selection),finished,resetReason:resume?.resetReason??options.resetReason});
  if(resume?.finished)return {selection,audit:selectionCheckpointAudit(resume)};
  if(!resume)await options.onCheckpoint?.(snapshot(false));
  while(true){
    options.beforeBatch?.();
    const selectedIds=new Set(selection.items.map(item=>item.questionId));
    // Previous choices can move between compatible groups to resolve allocation conflicts.
    const pools=lists.map(list=>list.filter(hit=>selectedIds.has(hit.id)).map(hit=>hit.id));
    const pending=slots.map((slot,index)=>selection.items.filter(item=>item.slotIndex===index).length<slot.count);
    let added=pools.reduce((count,pool,index)=>count+pool.filter(id=>!seen[index].has(id)).length,0); const fresh=new Set<string>();
    for(let pass=0;pass<24;pass++) for(let index=0;index<slots.length;index++){
      if(!pending[index])continue;
      let hit:RetrievalHit|undefined;
      while(positions[index]<lists[index].length){
        const next=lists[index][positions[index]];
        if(pools[index].includes(next.id)){positions[index]++;continue;}
        if(!fresh.has(next.id)&&fresh.size>=60)break;
        positions[index]++;hit=next;break;
      }
      if(hit){pools[index].push(hit.id);fresh.add(hit.id);seen[index].add(hit.id);added++;}
    }
    if(!added){await options.onCheckpoint?.(snapshot(true));break;}
    const result=await compare(pools,selection,++rounds);
    if(result.traceId)traceIds.push(result.traceId);
    selection={items:result.items,gaps:result.gaps};
    for(let index=0;index<pools.length;index++)for(const id of pools[index])seen[index].add(id);
    const retained=new Set(selection.items.map(item=>item.questionId));
    const finished=!selection.gaps.length||selection.gaps.every(gap=>positions[gap.slotIndex]>=lists[gap.slotIndex].length&&!lists[gap.slotIndex].some(hit=>retained.has(hit.id)&&!seen[gap.slotIndex].has(hit.id)));
    await options.onCheckpoint?.(snapshot(finished));
    if(finished)break;
  }
  const audit:SelectionAudit={rounds,traceIds,slots:lists.map((list,slotIndex)=>({slotIndex,eligible:list.length,compared:seen[slotIndex].size,remaining:list.length-seen[slotIndex].size}))};
  return {selection,audit};
}
