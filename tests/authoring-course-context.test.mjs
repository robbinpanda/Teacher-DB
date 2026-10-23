import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringCourseContext,courseProgressionChecks} from '../lib/authoring-course-context.ts';
const scope={subject:'数学',stage:'high'},id=topic=>`math.high.trigonometry.${topic}`;
const chapter=(key,knowledge,difficulty=2)=>({id:key,title:key,knowledgeIds:knowledge,prerequisites:[],objectives:['理解并应用本章知识'],teachingNotes:'',slots:[{role:'example',knowledgeIds:knowledge,type:'fill',count:1,score:0,purpose:'理解公式适用条件',difficulty}]});
const plan={title:'三角函数',audience:'首次系统学习三角函数的学生',approach:'先定义、后变换，再应用',assumptions:['只默认掌握初中代数'],estimatedMinutes:180,chapters:[chapter('definition',[id('definition')]),chapter('reduction',[id('reduction')]),chapter('double',[id('double'),id('definition')],4)]};

test('课程上下文区分前章计划、后章新知识和册外前置，不把复习重复项算作尚未引入',()=>{
 const context=authoringCourseContext(plan,'reduction',scope);
 assert.equal(context.currentPosition,2);assert.equal(context.chapterCount,3);
 assert.deepEqual(context.priorPlannedKnowledgeIds,[id('definition')]);assert.deepEqual(context.laterOnlyKnowledgeIds,[id('double')]);
 assert.deepEqual(context.outline.map(c=>c.difficultyRange),[[2,2],[2,2],[4,4]]);
 assert.ok(context.assumedPrerequisites.some(p=>p.id===id('angle')));
 assert.equal(context.knowledge.find(k=>k.id===id('double')).label,'二倍角公式');
 assert.deepEqual(context.assumptions,plan.assumptions);assert.equal('learnedKnowledgeIds' in context,false);
 assert.deepEqual(authoringCourseContext(plan,'definition',scope).priorPlannedKnowledgeIds,[]);
 assert.throws(()=>authoringCourseContext(plan,'missing',scope),/不在/);
});

test('课程衔接核查只要求讲义教辅，不把考试卷当新授课程',()=>{
 assert.equal(courseProgressionChecks('handout')[0].id,'curriculum.progression');
 assert.deepEqual(courseProgressionChecks('book'),courseProgressionChecks('handout'));
 assert.deepEqual(courseProgressionChecks('paper'),[]);assert.deepEqual(courseProgressionChecks('variation'),[]);
});
