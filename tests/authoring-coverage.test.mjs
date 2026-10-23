import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateUniqueQuestions,inspectWorkCoverage} from '../lib/authoring-coverage.ts';
const candidate=id=>({id,key:id});
test('整份作品分配不重复计算共享候选，并把宽范围题让给只有一个候选的组',()=>{
 const result=allocateUniqueQuestions([{count:1,candidates:['a','b'].map(candidate)},{count:1,candidates:[candidate('a')]}]);
 assert.deepEqual(result,[['b'],['a']]);
 const duplicate=allocateUniqueQuestions([{count:2,candidates:[{id:'a',key:'same-stem'},{id:'copy',key:'same-stem'}]},{count:1,candidates:[{id:'another-copy',key:'same-stem'}]}]);
 assert.equal(duplicate.flat().length,1);
 const large=allocateUniqueQuestions([{count:100,candidates:Array.from({length:150},(_,i)=>candidate(String(i)))},{count:50,candidates:Array.from({length:150},(_,i)=>candidate(String(i)))}]);
 assert.equal(large.flat().length,150);assert.equal(new Set(large.flat()).size,150);
});
test('去重供给的最大分配数与小规模穷举一致，避免贪心低估缺口',()=>{
 const subsets=Array.from({length:8},(_,mask)=>['a','b','c'].filter((_,i)=>mask&(1<<i)));
 for(const left of subsets)for(const right of subsets){
  const groups=[{count:2,candidates:left.map(candidate)},{count:1,candidates:right.map(candidate)}];
  const choices=[left,left,right];let best=0;
  function visit(i,used){if(i===3){best=Math.max(best,used.size);return;}visit(i+1,used);for(const id of choices[i])if(!used.has(id)){used.add(id);visit(i+1,used);used.delete(id);}}
  visit(0,new Set());assert.equal(allocateUniqueQuestions(groups).flat().length,best);
 }
});
const id='math.high.trigonometry.period',scope={subject:'数学',stage:'high'},request={kind:'handout',requiredKnowledgeIds:[id]};
const slots=[{role:'example',knowledgeIds:[id],count:1,difficulty:2},{role:'practice',knowledgeIds:[id],count:1,difficulty:3}];
const plan={chapters:[{id:'one',knowledgeIds:[id],slots},{id:'two',knowledgeIds:[id],slots}]};
function chapters(){return plan.chapters.map((plan,i)=>({id:plan.id,plan,status:'approved',content:{teacherApproval:{at:'now',note:''},knowledge:[{id,explanation:'对知识概念和公式条件进行完整说明。'.repeat(10)}],items:slots.map((_,j)=>({slotIndex:j,questionId:`q${i*2+j}`})),questions:slots.map((_,j)=>({id:`q${i*2+j}`,stem:`函数 sin(${i*2+j+1}x) 的周期`})),gaps:[]}}));}
test('作品覆盖基于实际正文、选题和教师采用；标题、建议、过期引用不能充数',()=>{
 const complete=inspectWorkCoverage(plan,request,chapters(),scope);assert.equal(complete.ready,true);assert.equal(complete.adoptedQuestions,4);assert.equal(complete.rows[0].roles.example.adopted,2);
 const none=inspectWorkCoverage(plan,request,[],scope);assert.equal(none.rows[0].written,false);assert.equal(none.ready,false);
 const unapproved=chapters();unapproved[0].status='complete';delete unapproved[0].content.teacherApproval;
 assert.equal(inspectWorkCoverage(plan,request,unapproved,scope).adoptedQuestions,2);
 const stale=inspectWorkCoverage(plan,request,chapters(),scope,['q0']);assert.equal(stale.ready,false);assert.equal(stale.selectedQuestions,3);
 const copies=chapters();copies[1].content.questions[0].stem=copies[0].content.questions[0].stem;
 const duplicate=inspectWorkCoverage(plan,request,copies,scope);assert.equal(duplicate.ready,false);assert.deepEqual(duplicate.duplicateQuestionIds,['q2']);
 const noBody=chapters();noBody.forEach(c=>c.content.knowledge=[]);assert.equal(inspectWorkCoverage(plan,request,noBody,scope).ready,false);
});
test('宽泛父标签不能证明所有子考点有选题，试卷父类只按父类汇总',()=>{
 const broad={chapters:[{id:'broad',knowledgeIds:['math.high.trigonometry'],slots:[{role:'assessment',knowledgeIds:['math.high.trigonometry'],count:1,difficulty:2}]}]};
 const data=[{id:'broad',plan:broad.chapters[0],status:'approved',content:{teacherApproval:{at:'now'},knowledge:[],gaps:[],items:[{slotIndex:0,questionId:'q'}],questions:[{id:'q',stem:'sample'}]}}];
 assert.equal(inspectWorkCoverage(broad,{kind:'paper',requiredKnowledgeIds:[]},data,scope).rows.length,1);
 const required=inspectWorkCoverage(broad,{kind:'paper',requiredKnowledgeIds:[id]},data,scope);
 assert.equal(required.rows.find(row=>row.id===id).roles.assessment.selected,0);assert.equal(required.ready,false);
});

test('整份作品采用后同题干不同选项或题图仍计为不同题，真正复制阻止发布',()=>{
 for(const kind of ['options','images','formula']){
  const values=chapters(),a=values[0].content.questions[0],b=values[1].content.questions[0];
  a.stem=b.stem='如图，选择正确的周期。';
  if(kind==='options'){a.options=[{key:'A',content:'π'}];b.options=[{key:'A',content:'2π'}];}
  if(kind==='images'){a.assets=[{role:'question',cropKey:'a.png'}];b.assets=[{role:'question',cropKey:'b.png'}];}
  if(kind==='formula'){a.stem=String.raw`求 $\frac{1}{23}$`;b.stem=String.raw`求 $\frac{12}{3}$`;}
  assert.equal(inspectWorkCoverage(plan,request,values,scope).ready,true);
  values[1].content.questions[0]={...a,id:b.id};
  assert.equal(inspectWorkCoverage(plan,request,values,scope).ready,false);
 }
});
