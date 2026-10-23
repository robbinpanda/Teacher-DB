import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuthoringRequest,validateAuthoringPlan,planSummary,assumedPrerequisites } from '../lib/authoring-plan.ts';
import { trigonometryKnowledge } from '../lib/knowledge-catalog.ts';
const scope={subject:'数学',stage:'high'},period='math.high.trigonometry.period';
const request=validateAuthoringRequest({kind:'handout',instruction:'给高三学生制作三角函数周期讲义',requiredKnowledgeIds:[period]},scope);
const slot={role:'example',knowledgeIds:[period],difficulty:2,type:'fill',count:2,score:0,purpose:'直接运用周期公式'};
const plan={title:'周期专题讲义',audience:'高三学生',approach:'由周期定义过渡到复合角周期计算',estimatedMinutes:45,assumptions:['学生已掌握弧度制'],chapters:[{id:'period',title:'周期的概念与计算',objectives:['理解最小正周期的意义'],knowledgeIds:[period],prerequisites:[],teachingNotes:'先观察单位圆运动，再由图象解释周期。',slots:[slot,{...slot,role:'practice',count:4}]}]};
test('校本允许明确选择超过一百份资料，保留有界请求与整库语义',()=>{
 const documentIds=Array.from({length:1000},(_,i)=>`document-${i}`);
 assert.deepEqual(validateAuthoringRequest({...request,kind:'book',documentIds},scope).documentIds,documentIds);
 assert.throws(()=>validateAuthoringRequest({...request,documentIds:[...documentIds,'overflow']},scope),/最多选择 1000/);
 assert.deepEqual(validateAuthoringRequest({...request,documentIds:[]},scope).documentIds,[]);
});
test('讲义计划同时覆盖知识点、例题和练习，题量与分值可计算',()=>{
 assert.deepEqual(validateAuthoringPlan(plan,scope,request),plan);
 assert.deepEqual(planSummary(plan),{questionCount:6,totalScore:0,knowledgeCount:1});
});
test('拒绝只列标题却遗漏必覆盖叶节点的大纲',()=>{
 assert.throws(()=>validateAuthoringPlan(plan,scope,{...request,requiredKnowledgeIds:['math.high.trigonometry']}),/遗漏/);
 assert.throws(()=>validateAuthoringPlan({...plan,chapters:[{...plan.chapters[0],knowledgeIds:['math.high.trigonometry'],slots:[{...slot,knowledgeIds:['math.high.trigonometry']},{...slot,knowledgeIds:['math.high.trigonometry'],role:'practice'}]}]},scope,request),/具体考点/);
});
test('完整三角函数讲义依照先备知识顺序，每个考点必须同时安排例题练习',()=>{
 const chapterFor=node=>({...plan.chapters[0],id:node.id.split('.').pop(),title:node.label,knowledgeIds:[node.id],slots:[{...slot,knowledgeIds:[node.id]},{...slot,knowledgeIds:[node.id],role:'practice'}]});
 const full={...plan,chapters:trigonometryKnowledge.map(chapterFor)},fullRequest={...request,requiredKnowledgeIds:['math.high.trigonometry']};
 assert.equal(validateAuthoringPlan(full,scope,fullRequest).chapters.length,14);
 assert.deepEqual(assumedPrerequisites(full,scope),[]);
 const reversed={...full,chapters:[full.chapters[1],full.chapters[0],...full.chapters.slice(2)]};
 assert.throws(()=>validateAuthoringPlan(reversed,scope,fullRequest),/先于/);
 const combined={...plan.chapters[0],knowledgeIds:trigonometryKnowledge.slice(0,2).map(n=>n.id),slots:full.chapters.slice(0,2).flatMap(c=>c.slots)};
 assert.equal(validateAuthoringPlan({...plan,chapters:[combined]},scope,{...request,requiredKnowledgeIds:[]}).chapters.length,1);
 assert.throws(()=>validateAuthoringPlan({...plan,chapters:[{...combined,knowledgeIds:[...combined.knowledgeIds].reverse()}]},scope,{...request,requiredKnowledgeIds:[]}),/先于/);
 assert.throws(()=>validateAuthoringPlan({...plan,chapters:[{...combined,slots:combined.slots.slice(0,2)}]},scope,{...request,requiredKnowledgeIds:[]}),/缺少例题/);
 assert.deepEqual(assumedPrerequisites(plan,scope).map(n=>n.id),['math.high.trigonometry.graphs']);
 assert.throws(()=>validateAuthoringPlan({...full,chapters:[{...full.chapters[0],prerequisites:[period]},...full.chapters.slice(1)]},scope,fullRequest),/前置知识/);
});
test('没有练习、难度倒置、题目考点越界或重复章节不能冒充有效计划',()=>{
 for(const chapters of [
  [{...plan.chapters[0],slots:[slot]}],
  [{...plan.chapters[0],slots:[{...slot,difficulty:4},slot,{...slot,role:'practice'}]}],
  [{...plan.chapters[0],slots:[{...slot,knowledgeIds:['math.high.trigonometry.sum']},{...slot,role:'practice'}]}],
  [plan.chapters[0],plan.chapters[0]],
 ])assert.throws(()=>validateAuthoringPlan({...plan,chapters},scope,request));
});
test('整卷变式必须指定原卷，不能混入其他学段知识或越权字段',()=>{
 assert.throws(()=>validateAuthoringRequest({kind:'variation',instruction:'帮我制作这份试卷的变式卷'},scope));
 assert.throws(()=>validateAuthoringRequest({...request,ownerId:'other'},scope));
 assert.throws(()=>validateAuthoringRequest(request,{subject:'数学',stage:'middle'}));
});
