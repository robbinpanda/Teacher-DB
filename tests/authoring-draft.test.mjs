import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveChapterDraft} from '../lib/authoring-draft.ts';
const selection={items:[{questionId:'a',slotIndex:0,selectionReason:'本题方法和难度符合当前教学目标。'},{questionId:'b',slotIndex:1,selectionReason:'本题用于独立练习相同知识方法。'}],gaps:[{slotIndex:1,reason:'本组仍缺一道合适的练习题目。'}]};
const prose={introduction:'本章结合例题学习函数周期。',knowledge:[],conclusion:'请核对条件并总结周期公式。',items:[{questionId:'b',teachingExplanation:'练习讲解'},{questionId:'a',teachingExplanation:'例题讲解'}]};
test('正文只拥有讲解，按题号关联并保留可信分组、理由及真实缺口',()=>{
 const result=resolveChapterDraft(prose,selection);assert.deepEqual(result.items.map(i=>[i.questionId,i.slotIndex,i.teachingExplanation]),[['a',0,'例题讲解'],['b',1,'练习讲解']]);assert.deepEqual(result.gaps,selection.gaps);assert.equal(result.items[0].selectionReason,selection.items[0].selectionReason);
});
test('正文缺题、重复题或换题均拒绝，不能通过补空讲解掩盖',()=>{
 for(const items of [prose.items.slice(0,1),[prose.items[0],prose.items[0]],[prose.items[0],{...prose.items[1],questionId:'other'}]])assert.throws(()=>resolveChapterDraft({...prose,items},selection),/不能遗漏/);
});
test('旧协议仍验证题目分组和缺口，拒绝元数据漂移及新旧字段混用',()=>{
 const legacy=resolveChapterDraft(prose,selection);assert.deepEqual(resolveChapterDraft(legacy,selection),legacy);
 assert.throws(()=>resolveChapterDraft({...legacy,gaps:[]},selection),/真实缺口/);
 assert.throws(()=>resolveChapterDraft({...legacy,items:legacy.items.map(i=>({...i,slotIndex:0}))},selection),/分组/);
 assert.throws(()=>resolveChapterDraft({...prose,items:prose.items.map(i=>({...i,slotIndex:0}))},selection));
});
test('无选题也可写知识正文，但不能编造题目',()=>{
 const empty={items:[],gaps:selection.gaps};assert.deepEqual(resolveChapterDraft({...prose,items:[]},empty).gaps,empty.gaps);assert.throws(()=>resolveChapterDraft(prose,empty));
});
