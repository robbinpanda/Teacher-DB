import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChapterContent,validateChapterReview } from '../lib/authoring-content.ts';
const id='math.high.trigonometry.period';
const slot={role:'example',knowledgeIds:[id],difficulty:2,type:'fill',count:1,score:0,purpose:'计算最小正周期'};
const plan={id:'period',title:'周期',objectives:['理解最小正周期'],knowledgeIds:[id],prerequisites:[],teachingNotes:'',slots:[slot,{...slot,role:'practice'}]};
const content={introduction:'本章从单位圆的转动认识周期现象。',knowledge:[{id,title:'周期的意义',explanation:'函数经过一个固定的自变量增量后，所有对应函数值重复出现，称这个增量为一个周期。最小正周期需要保证在全部定义域上成立，不能只看少数点。通过单位圆上点重复回到原位置，可以解释正弦与余弦函数的周期性质。',formulas:[{latex:'T=2\\pi/|\\omega|',conditions:'正弦余弦型，振幅与角系数均非零。'}],method:'先判断函数类型与定义域，再确定自变量的角系数，使用周期公式并检查是否为最小正周期。',misconceptions:[{mistake:'把某两点的函数值相等当成周期。',correction:'周期要求全部定义域内对应点满足重复关系，单独两点不够。'}]}],items:[{slotIndex:0,questionId:'a',selectionReason:'该题直接考查角系数与周期之间的关系。',teachingExplanation:'先观察函数的角系数，再识别它是正弦函数的伸缩形式。把角系数的绝对值代入周期公式进行计算，随后回到定义检查当自变量增加这个长度时函数值是否处处重复，最后说明更小正增量无法实现处处重复。'},{slotIndex:1,questionId:'b',selectionReason:'同知识点的独立巩固练习，避免机械重复原例题。',teachingExplanation:''}],gaps:[],conclusion:'本章应掌握从定义、图象与解析式三个角度认识周期。'};
test('逐章正文必须具备知识解释、公式条件、误区、例题讲解和完整配额',()=>{
 assert.equal(validateChapterContent(content,plan,'handout',[['a'],['b']],new Set()).items.length,2);
 assert.throws(()=>validateChapterContent({...content,knowledge:[]},plan,'handout',[['a'],['b']],new Set()),/缺少/);
 assert.throws(()=>validateChapterContent({...content,items:[{...content.items[0],teachingExplanation:''},content.items[1]]},plan,'handout',[['a'],['b']],new Set()),/讲解/);
});
test('拒绝虚构候选、跨章重复、配额不足不报告或无效缺口',()=>{
 assert.throws(()=>validateChapterContent(content,plan,'handout',[[],['b']],new Set()),/候选/);
 assert.throws(()=>validateChapterContent(content,plan,'handout',[['a'],['b']],new Set(['a'])),/重复/);
 assert.throws(()=>validateChapterContent({...content,items:[content.items[0]]},plan,'handout',[['a'],['b']],new Set()),/缺口/);
 assert.equal(validateChapterContent({...content,items:[content.items[0]],gaps:[{slotIndex:1,reason:'当前资料没有符合难度的独立练习题。'}]},plan,'handout',[['a'],[]],new Set()).gaps.length,1);
});
test('审校不能跳过题目或知识点；任一不通过均保留具体问题',()=>{
 const review={knowledge:[{id,correct:true,complete:true,reason:'定义与公式条件均清楚，覆盖本章知识目标。'}],questions:['a','b'].map(id=>({id,aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'知识目标一致，例题推导与原题答案相符。'}))};
 assert.equal(validateChapterReview(review,content).passed,true);
 assert.throws(()=>validateChapterReview({...review,questions:review.questions.slice(0,1)},content),/逐项/);
 assert.equal(validateChapterReview({...review,questions:[{...review.questions[0],explanationCorrect:false},review.questions[1]]},content).passed,false);
});

 test('学科核查必须全部覆盖、引用原文，不能用笼统通过掩盖错误',()=>{
  const checks=[{id:'period.constant',requirement:'核验振幅与角系数非零条件'}];
  const review={knowledge:[{id,correct:true,complete:true,reason:'定义与公式条件均清楚，覆盖本章知识目标。'}],questions:['a','b'].map(id=>({id,aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'知识目标一致，例题推导与原题答案相符。'})),checks:[{id:'period.constant',passed:false,evidence:content.knowledge[0].formulas[0].conditions,reason:'需要结合原定义域核对退化为常函数时的最小正周期。'}]};
  assert.equal(validateChapterReview(review,content,checks).passed,false);
  assert.equal(validateChapterReview({...review,checks:[{...review.checks[0],evidence:`'${review.checks[0].evidence}'`}]},content,checks).passed,false);
  assert.throws(()=>validateChapterReview({...review,checks:[]},content,checks),/学科核查/);
  assert.throws(()=>validateChapterReview({...review,checks:[{...review.checks[0],evidence:'本章中不存在的句子'}]},content,checks),/逐字引用/);
 });
