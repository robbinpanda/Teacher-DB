import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthoringRequirements, inspectPlanRequirements, assertPlanRequirements } from '../lib/authoring-requirements.ts';
import { validateAuthoringPlan, validateAuthoringRequest } from '../lib/authoring-plan.ts';
const scope={subject:'数学',stage:'high'}, period='math.high.trigonometry.period';
const requirements=numeric=>({numeric,knowledge:[],questions:[],assumptions:[]});
const item=(value,patch={})=>({metric:'questions',scope:'work',roles:[],types:[],levels:[],withinRoles:[],withinTypes:[],operator:'eq',value,evidence:`${value} 道题`,...patch});
const slot={role:'example',knowledgeIds:[period],difficulty:2,type:'fill',count:2,score:5,purpose:'使用周期公式计算结果'};
const chapter={id:'period',title:'周期知识讲解',knowledgeIds:[period],prerequisites:[],objectives:['能够运用周期公式计算'],teachingNotes:'通过例题归纳方法',slots:[slot,{...slot,role:'practice',difficulty:4,count:4,score:10,type:'answer'}]};
const plan={title:'周期专题讲义',audience:'高三学生',approach:'由概念到计算，再独立完成练习。',estimatedMinutes:90,assumptions:[],chapters:[chapter]};
const parse=(entry,text=entry.evidence)=>parseAuthoringRequirements(requirements([entry]),scope,text);
test('要求数值必须有连续原文依据，支持中文、全角、小时换算和成数',()=>{
 for(const [text,value,metric] of [['二十四道题',24,'questions'],['一百零二道题',102,'questions'],['二〇二六道题',2026,'questions'],['１２０分钟',120,'minutes'],['一小时半',90,'minutes'],['一个小时三十分钟',90,'minutes'],['半小时',30,'minutes'],['基础题六成',60,'percent']]) assert.equal(parse(item(value,{metric,evidence:text})).numeric[0].value,value);
 assert.throws(()=>parse(item(20,{evidence:'题量二十四'})),/找不到/);
 assert.throws(()=>parse(item(20),'请出三十道题'),/逐字/);
 assert.throws(()=>parse(item(2.5)),/整数/);
 assert.throws(()=>parse(item(120,{metric:'percent'})),/超过/);
 assert.throws(()=>parse(item(90,{metric:'minutes',scope:'eachChapter'})),/整份/);
 assert.throws(()=>parseAuthoringRequirements({...requirements([]),knowledge:[{id:'other',evidence:'周期'}]},scope,'周期讲义'),/范围/);
});
test('教师可明确修订数值，仍保留原话和学科范围核验',()=>{
 assert.equal(parse(item(90,{metric:'minutes',evidence:'一个半小时'})).numeric[0].value,90);
 const result=parseAuthoringRequirements(requirements([item(6,{evidence:'四道练习'})]),scope,'四道练习',true);
 assert.equal(result.editedByTeacher,true); assert.equal(result.numeric[0].value,6);
 assert.throws(()=>parseAuthoringRequirements(requirements([item(6,{evidence:'未曾说过'})]),scope,'四道练习',true),/逐字/);
});
test('一次反馈全部原文问题，并拒绝遗漏筛选条件造成的冲突数量',()=>{
 assert.throws(()=>parseAuthoringRequirements(requirements([item(12,{evidence:'全是填空'}),item(5,{metric:'scorePerQuestion',evidence:'每题五分',withinTypes:['fill']})]),scope,'全是填空，每题五分'),error=>error.message.includes('questions/work=12')&&error.message.includes('withinRoles/withinTypes'));
 assert.throws(()=>parseAuthoringRequirements(requirements([item(60,{metric:'percent',evidence:'基础题占六成'}),item(40,{metric:'percent',evidence:'提高题占四成'})]),scope,'基础题占六成，提高题占四成'),/同一组题目有冲突/);
 assert.throws(()=>parseAuthoringRequirements({...requirements([]),knowledge:[{id:'math.high.triangle',evidence:'完整覆盖三角函数'}]},scope,'完整覆盖三角函数'),/扩大范围/);
 assert.equal(parseAuthoringRequirements({...requirements([]),knowledge:[{id:'math.high.triangle',evidence:'三角函数与正弦定理'}]},scope,'三角函数与正弦定理').knowledge.length,1);
});
test('总题数、各题型题数、每题分数、总分、时长分别核算，不以模型自述通过',()=>{
 const r=requirements([item(6),item(4,{types:['answer']}),item(10,{metric:'scorePerQuestion',types:['answer']}),item(50,{metric:'score'}),item(90,{metric:'minutes'}),item(1,{metric:'chapters'})]);
 assert.equal(inspectPlanRequirements(plan,r,scope).every(c=>c.passed),true);
 const wrong={...plan,chapters:[{...chapter,slots:[slot,{...chapter.slots[1],score:9}]}]};
 assert.deepEqual(inspectPlanRequirements(wrong,r,scope).map(c=>c.passed),[true,true,false,false,true,true]);
 assert.throws(()=>assertPlanRequirements(wrong,r,scope),/实际.*46/);
 assert.equal(inspectPlanRequirements(plan,requirements([item(0,{types:['multiple']})]))[0].passed,true);
 assert.equal(inspectPlanRequirements(plan,requirements([item(5,{metric:'scorePerQuestion',types:['multiple']})]))[0].passed,false);
});

test('明确父范围不因追问是否增加同级范围而阻塞，真实歧义和教师修订保留',()=>{
 const text='完整覆盖三角函数全部知识点，每章两道例题。';
 const value={...requirements([]),knowledge:[{id:'math.high.trigonometry',evidence:'完整覆盖三角函数全部知识点'}],questions:[{evidence:'完整覆盖三角函数全部知识点',question:'是否包含解三角形的正弦定理和余弦定理？'}]};
 assert.throws(()=>parseAuthoringRequirements(value,scope,text),/不应为未要求的同级知识范围阻塞/);
 assert.equal(parseAuthoringRequirements(value,scope,text,true).questions.length,1,'explicit teacher clarification is preserved');
 assert.equal(parseAuthoringRequirements(value,scope,text+'另外考虑加入解三角形，但范围还未确定。').questions.length,1);
 const numeric={...value,questions:[{evidence:'每章两道例题',question:'两道例题各占多少分，还是统一不设置分值？'}]};
 assert.equal(parseAuthoringRequirements(numeric,scope,text).questions.length,1,'this guard does not silently discard other question types');
 const ambiguous={...requirements([]),questions:[{evidence:'函数专题',question:'函数专题是否包括三角函数？'}]};
 assert.equal(parseAuthoringRequirements(ambiguous,scope,'做函数专题讲义，范围待确定。').questions.length,1);
});
test('每章和每个考点分别核算，不能用平均题量掩盖某章缺额',()=>{
 assert.equal(inspectPlanRequirements(plan,requirements([item(1,{metric:'knowledgePoints',scope:'eachChapter'})]))[0].passed,true);
 const second={...chapter,id:'transfer',title:'迁移练习',slots:[{...slot,count:1},{...chapter.slots[1],count:5}]};
 const two={...plan,chapters:[chapter,second]};
 assert.equal(inspectPlanRequirements(two,requirements([item(2,{roles:['example'],scope:'eachChapter'})]))[0].passed,false);
 const r=requirements([item(3,{roles:['example'],scope:'eachKnowledge'})]);
 assert.equal(inspectPlanRequirements(two,r,scope)[0].passed,true);
 assert.ok(!inspectPlanRequirements(two,r,scope)[0].actual.includes('math.high'));
});
test('全部为某题型的要求不能被未指定题型或其他题型配额绕过',()=>{
 const r=parseAuthoringRequirements({...requirements([]),questionTypes:[{types:['fill'],evidence:'全部为填空题'}]},scope,'全部为填空题');
 assert.equal(inspectPlanRequirements(plan,r)[0].passed,false);
 const valid={...plan,chapters:[{...chapter,slots:[slot]}]};
 assert.equal(inspectPlanRequirements(valid,r)[0].passed,true);
 assert.equal(inspectPlanRequirements({...valid,chapters:[{...chapter,slots:[{...slot,type:'any'}]}]},r)[0].passed,false);
});
test('试卷所有卷面题均为检测，不能把额外例题排除在题量核算外',()=>{
 const request=validateAuthoringRequest({kind:'paper',instruction:'请编写周期专题试卷，共六道题'},scope),r=requirements([item(6)]);
 assert.throws(()=>validateAuthoringPlan(plan,scope,request,r),/只安排 assessment/);
 assert.equal(validateAuthoringPlan({...plan,chapters:[{...chapter,slots:chapter.slots.map(s=>({...s,role:'assessment'}))}]},scope,request,r).chapters.length,1);
});
test('占比分子限于指定分母集合；没有分母不能当作零占比通过',()=>{
 const r=requirements([item(100,{metric:'percent',levels:[4],withinRoles:['practice']})]);
 assert.equal(inspectPlanRequirements(plan,r)[0].passed,true);
 const highExamples={...plan,chapters:[{...chapter,slots:[{...slot,difficulty:4},chapter.slots[1]]}]};
 assert.equal(inspectPlanRequirements(highExamples,r)[0].passed,true);
 assert.equal(inspectPlanRequirements(plan,requirements([item(0,{metric:'percent',withinTypes:['multiple']})]))[0].passed,false);
});
test('上下限与严格比较保持原意；澄清项阻止生成，原话知识范围参与计划检查',()=>{
 for(const [operator,value,expected] of [['eq',6,true],['min',5,true],['max',6,true],['gt',6,false],['lt',7,true]]) assert.equal(inspectPlanRequirements(plan,requirements([item(value,{operator})]))[0].passed,expected);
 const ambiguous={...requirements([]),questions:[{evidence:'一百多题',question:'请明确题数或范围。'}]};
 assert.throws(()=>assertPlanRequirements(plan,ambiguous),/仍需澄清/);
 const request=validateAuthoringRequest({kind:'handout',instruction:'编写完整三角函数的详细复习讲义'},scope);
 assert.throws(()=>validateAuthoringPlan(plan,scope,request,{...requirements([]),knowledge:[{id:'math.high.trigonometry',evidence:'完整三角函数'}]}),/遗漏/);
 assert.throws(()=>validateAuthoringPlan(plan,scope,request,requirements([item(8)])),/未满足/);
});
