import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterCandidateLists, diversifyCandidates, selectCandidateBatches } from '../lib/authoring-candidates.ts';
import { fingerprintRow,matchQuestions } from '../lib/knowledge-retrieval.ts';
const scope={subject:'数学',stage:'high'},period='math.high.trigonometry.period';
const slot={role:'example',knowledgeIds:[period],difficulty:2,type:'fill',count:1,score:5,purpose:'掌握周期公式的计算'};
const row=(id,extra={})=>({id,type:'fill',stem:`求函数 sin(${id}x) 的最小正周期`,optionsJson:null,answer:'参考答案',analysis:'使用周期公式',documentId:'a',documentName:'题库',grade:'高三',tagsJson:'[]',assetsJson:'[]',classificationJson:null,classificationFingerprint:null,classificationStatus:null,...extra});
const tagged=(id,difficulty,status='confirmed')=>{const r=row(id,{classificationJson:JSON.stringify({knowledge:[{id:period,evidence:'明确考查正弦函数的最小正周期'}],methods:['公式变形'],competencies:['数学运算'],difficulty,difficultyReason:'根据角系数计算最小正周期',prerequisites:[],confidence:.9}),classificationStatus:status});r.classificationFingerprint=fingerprintRow(r,scope);return r;};

test('自动选题不让宽泛回退覆盖有效难度；旧标签和未知难度保持待判断',()=>{
 const stale={...tagged('stale',5),answer:'changed'};
 const rows=[tagged('right',2),tagged('wrong',5),tagged('suggested-wrong',3,'suggested'),row('unknown'),stale,row('wrong-type',{type:'answer'})];
 const ids=chapterCandidateLists(rows,scope,[slot])[0].map(hit=>hit.id);
 assert.deepEqual(new Set(ids),new Set(['right','unknown','stale']));
});
test('同分按来源轮换但确认依据优先，同题干只占一次候选容量',()=>{
 const rows=[...Array.from({length:30},(_,i)=>row(`a${String(i).padStart(2,'0')}`)),row('z-source',{documentId:'b'}),tagged('confirmed',2)];
 const hits=matchQuestions(rows,scope,{knowledgeIds:[period]}).hits;
 const result=diversifyCandidates([...hits,{...hits[0],id:'duplicate',score:1}]);
 assert.equal(result[0].id,'confirmed');assert.equal(result[2].id,'z-source');assert.equal(result.length,rows.length);
});
test('缺题会检查超过旧 100 道上限的后续候选，最终记录真实比较数量',async()=>{
 const rows=Array.from({length:131},(_,i)=>row(String(i).padStart(3,'0')));
 const lists=chapterCandidateLists(rows,scope,[slot]);let calls=0;
 const result=await selectCandidateBatches(lists,[slot],async pools=>{calls++;return pools[0].includes('130')?{items:[{slotIndex:0,questionId:'130',selectionReason:'唯一满足额外教学目标的题目'}],gaps:[],traceId:`trace-${calls}`}:{items:[],gaps:[{slotIndex:0,reason:'本批题目不适合指定教学目标'}],traceId:`trace-${calls}`};});
 assert.equal(calls,6);assert.equal(result.selection.items[0].questionId,'130');assert.deepEqual(result.audit.slots,[{slotIndex:0,eligible:131,compared:131,remaining:0}]);assert.equal(result.audit.traceIds.length,6);
});
test('足量即停止且公开尚未比较的候选；分批保留已选题并允许兼容组重分配',async()=>{
 const lists=chapterCandidateLists(Array.from({length:80},(_,i)=>row(String(i).padStart(3,'0'))),scope,[slot,slot]);
 let rounds=0;
 const result=await selectCandidateBatches(lists,[slot,slot],async (pools,previous)=>{
  rounds++;
  if(rounds===1)return {items:[{slotIndex:0,questionId:'000',selectionReason:'本批已找到合适例题'}],gaps:[{slotIndex:1,reason:'本批还没有适合的练习'}]};
  assert.ok(pools[0].includes('000')&&pools[1].includes('000'));assert.equal(previous.items[0].questionId,'000');assert.ok(pools[1].includes('030'));
  return {items:[{slotIndex:0,questionId:'000',selectionReason:'保留已选例题'},{slotIndex:1,questionId:'030',selectionReason:'后续批次找到迁移练习'}],gaps:[]};
 });
 assert.equal(rounds,2);assert.equal(result.audit.slots[0].compared,24);assert.equal(result.audit.slots[1].compared,48);assert.equal(result.audit.slots[1].remaining,32);
});
test('空候选不调用模型；模型拒绝全部候选也会终止并保留缺口',async()=>{
 let calls=0;
 const empty=await selectCandidateBatches([[]],[slot],async()=>{calls++;throw new Error('should not call');});assert.equal(calls,0);assert.equal(empty.selection.gaps.length,1);
 const lists=chapterCandidateLists(Array.from({length:50},(_,i)=>row(String(i))),scope,[slot]);
 const result=await selectCandidateBatches(lists,[slot],async()=>{calls++;return {items:[],gaps:[{slotIndex:0,reason:'候选均不适合指定教学任务'}]};});
 assert.equal(calls,3);assert.equal(result.audit.slots[0].remaining,0);assert.equal(result.selection.gaps.length,1);
});
test('题干明确考点优先于解析偶然提及，排序不赋予确认状态或难度',()=>{
 const direct=row('z-direct'),indirect=row('a-indirect',{stem:'求一个参数的值。',analysis:'可以利用最小正周期解答。'});
 const result=matchQuestions([indirect,direct],scope,{knowledgeIds:[period]});assert.deepEqual(result.hits.map(h=>h.id),['z-direct','a-indirect']);assert.equal(result.hits[0].classification,null);assert.deepEqual(result.hits[0].matchedKnowledgeIds,[]);
});
test('多组共享候选按不同题目计整轮预算，不让重复 ID 耗尽比较容量',async()=>{
 const slots=Array.from({length:30},()=>slot),lists=chapterCandidateLists(Array.from({length:80},(_,i)=>row(String(i).padStart(3,'0'))),scope,slots);
 let calls=0;
 const result=await selectCandidateBatches(lists,slots,async pools=>{
  calls++;if(calls===1){assert.equal(new Set(pools.flat()).size,24);assert.ok(pools.every(pool=>pool.length===24));}
  const selected=new Set(),items=[],gaps=[];
  for(let slotIndex=0;slotIndex<slots.length;slotIndex++){const id=pools[slotIndex].find(id=>!selected.has(id));if(id){selected.add(id);items.push({slotIndex,questionId:id,selectionReason:'选择不同题目以满足各组配额'});}else gaps.push({slotIndex,reason:'当前批次独立题目不足'});}
  return {items,gaps};
 });
 assert.equal(calls,2);assert.equal(result.selection.items.length,30);assert.equal(result.selection.gaps.length,0);
});
