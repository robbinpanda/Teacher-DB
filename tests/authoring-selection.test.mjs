import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterSelectionChoices,resolveChapterSelection} from '../lib/authoring-selection.ts';
import {validateChapterContent} from '../lib/authoring-content.ts';
const reason='该题完整考查本组目标，步骤与难度要求相符。';
const slot={role:'practice',knowledgeIds:['math.high.trigonometry.same-angle'],difficulty:2,type:'fill',count:1,score:0,purpose:'同角关系求值'};
const plan={id:'same-angle',title:'同角关系',objectives:['掌握同角关系'],knowledgeIds:slot.knowledgeIds,prerequisites:[],teachingNotes:'',slots:[slot,{...slot,difficulty:3},slot]};
const pools=[['a','c'],['b'],['a']];
const validate=value=>{const result=resolveChapterSelection(value,pools);return validateChapterContent({...result,introduction:'比较本章候选题并安排练习。',knowledge:[],conclusion:'后续将按具体教学目的编写正文。',items:result.items.map(item=>({...item,teachingExplanation:''}))},plan,'paper',pools,new Set());};
const gap=slotIndex=>({slotIndex,reason:'本批暂无更多符合要求的题目。'});
test('选择码固定绑定题目及有效难度组，不依赖模型拼接长ID',()=>{
 assert.deepEqual(chapterSelectionChoices(pools),[{choiceId:'S0-Q1',slotIndex:0,questionId:'a'},{choiceId:'S0-Q2',slotIndex:0,questionId:'c'},{choiceId:'S1-Q1',slotIndex:1,questionId:'b'},{choiceId:'S2-Q1',slotIndex:2,questionId:'a'}]);
 const content=validate({items:[{choiceId:'S1-Q1',selectionReason:reason}],gaps:[gap(0),gap(2)]});
 assert.deepEqual(content.items.map(item=>[item.slotIndex,item.questionId]),[[1,'b']]);
});
test('拒绝虚构选择码、混合伪造字段和旧协议跨组，不静默搬题',()=>{
 assert.throws(()=>resolveChapterSelection({items:[{choiceId:'S1-Q2',selectionReason:reason}],gaps:[]},pools),/不在本批/);
 assert.throws(()=>resolveChapterSelection({items:[{choiceId:'S1-Q1',slotIndex:0,questionId:'a',selectionReason:reason}],gaps:[]},pools));
 assert.throws(()=>validate({items:[{slotIndex:1,questionId:'a',selectionReason:reason}],gaps:[gap(0),gap(2)]}),/不在该组候选/);
});
test('新选择码仍必须遵守跨组去重和每组配额',()=>{
 assert.throws(()=>validate({items:[{choiceId:'S0-Q1',selectionReason:reason},{choiceId:'S2-Q1',selectionReason:reason}],gaps:[gap(1)]}),/重复选择/);
 assert.throws(()=>validate({items:[{choiceId:'S0-Q1',selectionReason:reason},{choiceId:'S0-Q2',selectionReason:reason}],gaps:[gap(1),gap(2)]}),/配额|数量|超/);
});

const recommend=(...codes)=>({recommendations:codes.map(choiceId=>({choiceId,selectionReason:reason})),gapReasons:[]});
test('推荐分配通过增广路径填满配额，仅使用模型明确推荐的兼容组合',()=>{
 const groups=[['a','b'],['a']],slots=[{role:'example',count:1},{role:'practice',count:1}];
 const result=resolveChapterSelection(recommend('S0-Q1','S0-Q2','S1-Q1'),groups,slots);
 assert.deepEqual(result.items.map(i=>[i.slotIndex,i.questionId]),[[0,'b'],[1,'a']]);assert.deepEqual(result.gaps,[]);
});
test('共享题只占一席，题源不足时优先保留例题并报告真实缺口',()=>{
 const result=resolveChapterSelection(recommend('S0-Q1','S1-Q1'),[['a'],['a']],[{role:'example',count:1},{role:'practice',count:1}]);
 assert.deepEqual(result.items.map(i=>i.slotIndex),[0]);assert.deepEqual(result.gaps.map(i=>i.slotIndex),[1]);
});
test('超额推荐不会超配额，不采纳未推荐的候选题，已填满组不留过期缺口',()=>{
 const response=recommend('S0-Q1','S0-Q2');response.gapReasons=[gap(0)];
 const result=resolveChapterSelection(response,[['a','b'],['c']],[{role:'practice',count:1},{role:'practice',count:1}]);
 assert.equal(result.items.length,1);assert.deepEqual(result.gaps.map(i=>i.slotIndex),[1]);
});
test('推荐协议拒绝虚构码、重复码、无效缺口和无效配额',()=>{
 const slots=[{role:'example',count:1}];
 assert.throws(()=>resolveChapterSelection(recommend('S0-Q2'),[['a']],slots),/不在本批/);
 assert.throws(()=>resolveChapterSelection(recommend('S0-Q1','S0-Q1'),[['a']],slots),/重复推荐/);
 assert.throws(()=>resolveChapterSelection({...recommend('S0-Q1'),gapReasons:[gap(1)]},[['a']],slots),/组号/);
 assert.throws(()=>resolveChapterSelection(recommend('S0-Q1'),[['a']],[{role:'example',count:-1}]),/配额/);
});
test('推荐分配结果继续通过章节硬约束校验',()=>{
 const result=resolveChapterSelection(recommend('S0-Q1','S0-Q2','S1-Q1','S2-Q1'),pools,plan.slots);
 const content=validateChapterContent({...result,introduction:'比较本章候选题并安排练习。',knowledge:[],conclusion:'后续将按具体教学目的编写正文。',items:result.items.map(item=>({...item,teachingExplanation:''}))},plan,'paper',pools,new Set());
 assert.equal(content.items.length,3);assert.equal(new Set(content.items.map(i=>i.questionId)).size,3);
});
