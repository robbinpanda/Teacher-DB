import { z } from "zod";

export function chapterSelectionChoices(pools: string[][]) {
  return pools.flatMap((pool, slotIndex) => pool.map((questionId, index) => ({
    choiceId: `S${slotIndex}-Q${index + 1}`, slotIndex, questionId,
  })));
}

const selectionSchema = z.object({
  items: z.array(z.union([
    z.object({ choiceId: z.string(), selectionReason: z.string() }).strict(),
    // Retain validation of older response contracts; never repair an invalid
    // question/slot pairing by silently moving it to a different group.
    z.object({ slotIndex: z.number().int(), questionId: z.string(), selectionReason: z.string() }).strict(),
  ])).max(30),
  gaps: z.array(z.object({ slotIndex: z.number().int(), reason: z.string() })).max(30),
});

const recommendationSchema = z.object({
  recommendations: z.array(z.object({choiceId:z.string(),selectionReason:z.string().trim().min(10).max(1200)}).strict()).max(180),
  gapReasons: z.array(z.object({slotIndex:z.number().int(),reason:z.string().trim().min(8).max(1200)})).max(30).default([]),
}).strict();

type Slot = {count:number;role:string};
export function resolveChapterSelection(value: unknown, pools: string[][], slots?: Slot[]) {
  if (value && typeof value === 'object' && 'recommendations' in value) {
    if (!slots || slots.length !== pools.length || slots.some(slot => !Number.isInteger(slot.count) || slot.count < 1) || slots.reduce((total,slot)=>total+slot.count,0)>30) throw new Error('推荐分配缺少有效的章节配额');
    const response=recommendationSchema.parse(value),choices=new Map(chapterSelectionChoices(pools).map(choice=>[choice.choiceId,choice]));
    const seen=new Set<string>();
    const recommendations=response.recommendations.map(item=>{
      const choice=choices.get(item.choiceId);
      if(!choice)throw new Error(`选择码 ${item.choiceId} 不在本批候选中，请原样复制 eligibleChoices 中的 choiceId。`);
      if(seen.has(item.choiceId))throw new Error(`选择码 ${item.choiceId} 被重复推荐，请每个选择码只列一次。`);
      seen.add(item.choiceId);return {...choice,selectionReason:item.selectionReason};
    });
    if(response.gapReasons.some(gap=>!slots[gap.slotIndex])||new Set(response.gapReasons.map(gap=>gap.slotIndex)).size!==response.gapReasons.length)throw new Error('推荐缺口的组号无效或重复');
    // Maximum matching fills as many seats as the recommended pairs permit.
    // Reassignment only follows another model-recommended, compatible pair.
    // Examples enter first; a later practice cannot leave an occupied example empty.
    const seats=slots.flatMap((slot,slotIndex)=>Array.from({length:slot.count},()=>({slotIndex,role:slot.role})))
      .sort((a,b)=>Number(b.role==='example')-Number(a.role==='example'));
    const byQuestion=new Map<string,number>(),assigned=new Map<number,typeof recommendations[number]>();
    function assign(seat:number,visited:Set<string>):boolean {
      for(const candidate of recommendations.filter(item=>item.slotIndex===seats[seat].slotIndex)){
        if(visited.has(candidate.questionId))continue;
        visited.add(candidate.questionId);const occupied=byQuestion.get(candidate.questionId);
        if(occupied===undefined||assign(occupied,visited)){
          byQuestion.set(candidate.questionId,seat);assigned.set(seat,candidate);return true;
        }
      }
      return false;
    }
    seats.forEach((_,seat)=>assign(seat,new Set()));
    const items=[...assigned.entries()].sort(([a],[b])=>a-b).map(([,item])=>({slotIndex:item.slotIndex,questionId:item.questionId,selectionReason:item.selectionReason}));
    const gaps=slots.flatMap((slot,slotIndex)=>{
      const missing=slot.count-items.filter(item=>item.slotIndex===slotIndex).length;
      return missing>0?[{slotIndex,reason:response.gapReasons.find(gap=>gap.slotIndex===slotIndex)?.reason??`本批合适推荐题经配额与去重分配后仍缺 ${missing} 道，需继续比较后续候选。`}]:[];
    });
    return {items,gaps};
  }
  const selection = selectionSchema.parse(value);
  const choices = new Map(chapterSelectionChoices(pools).map(choice => [choice.choiceId, choice]));
  const selected = new Map<string,string>();
  return { ...selection, items: selection.items.map(item => {
    const choice = "choiceId" in item ? choices.get(item.choiceId) : item;
    if (!choice) throw new Error(`选择码 ${"choiceId" in item ? item.choiceId : ""} 不在本批候选中，请原样复制 eligibleChoices 中的 choiceId，不猜测题号或组号。`);
    const label = "choiceId" in item ? item.choiceId : `slotIndex=${item.slotIndex},questionId=${item.questionId}`;
    const existing = selected.get(choice.questionId);
    if (existing) throw new Error(`重复选择同一道题：${existing} 与 ${label} 都指向 ${choice.questionId}。同一题不能同时作例题与练习；请只保留一个分组，其他位置另选不同题，无合适题则报告缺口。`);
    selected.set(choice.questionId,label);
    return { slotIndex: choice.slotIndex, questionId: choice.questionId, selectionReason: item.selectionReason };
  }) };
}
