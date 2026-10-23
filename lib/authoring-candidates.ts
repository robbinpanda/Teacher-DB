import { matchQuestions, type RetrievalRow, type RetrievalHit } from './knowledge-retrieval.ts';
import type { EducationScope } from './education-scope.ts';
import type { AuthoringChapterPlan } from './authoring-plan.ts';

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

/** Expand only while quotas remain missing; never confuse a truncated first batch with absence. */
export async function selectCandidateBatches(
  lists:RetrievalHit[][], slots:Slot[],
  compare:(pools:string[][],previous:Selection,round:number)=>Promise<Selection & {traceId?:string}>,
) {
  const positions=slots.map(()=>0), seen=slots.map(()=>new Set<string>());
  let selection:Selection={items:[],gaps:slots.map((_,slotIndex)=>({slotIndex,reason:'当前教学范围与题型、考点、已标注难度条件下没有可用候选。'}))};
  let rounds=0; const traceIds:string[]=[];
  while(true){
    const selectedIds=new Set(selection.items.map(item=>item.questionId));
    // Previous choices can move between compatible groups to resolve allocation conflicts.
    const pools=lists.map(list=>list.filter(hit=>selectedIds.has(hit.id)).map(hit=>hit.id));
    const pending=slots.map((slot,index)=>selection.items.filter(item=>item.slotIndex===index).length<slot.count);
    let added=0; const fresh=new Set<string>();
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
    if(!added)break;
    const result=await compare(pools,selection,++rounds);
    if(result.traceId)traceIds.push(result.traceId);
    selection={items:result.items,gaps:result.gaps};
    for(let index=0;index<pools.length;index++)for(const id of pools[index])seen[index].add(id);
    if(!selection.gaps.length)break;
  }
  const audit:SelectionAudit={rounds,traceIds,slots:lists.map((list,slotIndex)=>({slotIndex,eligible:list.length,compared:seen[slotIndex].size,remaining:list.length-seen[slotIndex].size}))};
  return {selection,audit};
}
