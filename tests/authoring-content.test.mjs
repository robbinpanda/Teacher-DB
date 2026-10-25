import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChapterContent,validateChapterReview } from '../lib/authoring-content.ts';
import { authoringReviewChecks } from '../lib/authoring-review-checks.ts';
import { knowledgeCatalog } from '../lib/knowledge-catalog.ts';
import { chapterReviewEvidence,chapterReviewPassages } from '../lib/authoring-review-evidence.ts';
const id='math.high.trigonometry.period';
const slot={role:'example',knowledgeIds:[id],difficulty:2,type:'fill',count:1,score:0,purpose:'计算最小正周期'};
const plan={id:'period',title:'周期',objectives:['理解最小正周期'],knowledgeIds:[id],prerequisites:[],teachingNotes:'',slots:[slot,{...slot,role:'practice'}]};
const content={introduction:'本章从单位圆的转动认识周期现象。',knowledge:[{id,title:'周期的意义',explanation:'函数经过一个固定的自变量增量后，所有对应函数值重复出现，称这个增量为一个周期。最小正周期需要保证在全部定义域上成立，不能只看少数点。通过单位圆上点重复回到原位置，可以解释正弦与余弦函数的周期性质。',formulas:[{latex:'T=2\\pi/|\\omega|',conditions:'正弦余弦型，振幅与角系数均非零。'}],method:'先判断函数类型与定义域，再确定自变量的角系数，使用周期公式并检查是否为最小正周期。',misconceptions:[{mistake:'把某两点的函数值相等当成周期。',correction:'周期要求全部定义域内对应点满足重复关系，单独两点不够。'}]}],items:[{slotIndex:0,questionId:'a',selectionReason:'该题直接考查角系数与周期之间的关系。',teachingExplanation:'先观察函数的角系数，再识别它是正弦函数的伸缩形式。把角系数的绝对值代入周期公式进行计算，随后回到定义检查当自变量增加这个长度时函数值是否处处重复，最后说明更小正增量无法实现处处重复。'},{slotIndex:1,questionId:'b',selectionReason:'同知识点的独立巩固练习，避免机械重复原例题。',teachingExplanation:''}],gaps:[],conclusion:'本章应掌握从定义、图象与解析式三个角度认识周期。'};

test('三角函数与解三角形的每个具体考点都有专项审校，父类展开且不重复',()=>{
 const parents=['math.high.trigonometry','math.high.triangle'];
 const leaves=knowledgeCatalog('数学','high').filter(node=>parents.includes(node.parentId));
 for(const node of leaves)assert.ok(authoringReviewChecks([node.id]).length>0,`${node.id} missing review checks`);
 const all=authoringReviewChecks(parents),expanded=authoringReviewChecks([...parents,...leaves.map(node=>node.id)]);
 assert.deepEqual(all,expanded);assert.equal(new Set(all.map(c=>c.id)).size,all.length);
 assert.deepEqual(authoringReviewChecks(['topic.语文.high.文言文']),[]);
 assert.equal(authoringReviewChecks([id]).length,5);
});
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

test('选题分组错误同时指出每个错放题目的允许组号，不放宽难度约束',()=>{
 const crossed={...content,items:[{...content.items[0],slotIndex:1},{...content.items[1],slotIndex:0}]};
 assert.throws(()=>validateChapterContent(crossed,plan,'handout',[['a'],['b']],new Set()),error=>{
  assert.match(error.message,/a 被放入 slotIndex=1.*允许的 slotIndex 为 \[0\]/);
  assert.match(error.message,/b 被放入 slotIndex=0.*允许的 slotIndex 为 \[1\]/);
  assert.match(error.message,/不能自行改变已标注难度/);return true;
 });
});
test('配额错误一次报告超额、遗漏缺口和错误缺口，不能静默删题或改分组',()=>{
 const expanded={...plan,slots:[...plan.slots,{...slot,role:'practice'}]};
 const invalid={...content,items:[...content.items.map(item=>({...item,slotIndex:0})),{...content.items[1],questionId:'c',slotIndex:2}],gaps:[{slotIndex:2,reason:'已经足额却错误写入缺口说明。'}]};
 assert.throws(()=>validateChapterContent(invalid,expanded,'paper',[['a','b'],[],['c']],new Set()),error=>{
  assert.match(error.message,/slotIndex=0 选题超过计划配额：要求 1 道，实际 2 道/);
  assert.match(error.message,/slotIndex=1 题量不足却没有说明缺口/);
  assert.match(error.message,/slotIndex=2 题量已满足，不应仍标记缺题/);
  return true;
 });
 assert.equal(invalid.items.length,3);
});

test('审校不能跳过题目或知识点；任一不通过均保留具体问题',()=>{
 const review={knowledge:[{id,correct:true,complete:true,reason:'定义与公式条件均清楚，覆盖本章知识目标。'}],questions:['a','b'].map(id=>({id,solvable:true,answerCorrect:true,computedAnswer:"$2\\pi$",aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'知识目标一致，例题推导与原题答案相符。'}))};
 assert.equal(validateChapterReview(review,content).passed,true);
 const advisory=validateChapterReview({...review,suggestions:['可增加一个生活中的周期现象作引入。']},content);
 assert.equal(advisory.passed,true);assert.equal(advisory.issues.length,0);assert.equal(advisory.suggestions.length,1);
 assert.throws(()=>validateChapterReview({...review,questions:review.questions.slice(0,1)},content),/逐项/);
 assert.equal(validateChapterReview({...review,questions:[{...review.questions[0],explanationCorrect:false},review.questions[1]]},content).passed,false);
 assert.equal(validateChapterReview({...review,suggestions:['可增加一个引入例子。'],knowledge:[{...review.knowledge[0],correct:false}]},content).passed,false);
});

test('没有讲解的练习仍需核验可解性和原题答案，保留逐题复算且不能默认缺失字段通过',()=>{
 const review={knowledge:[{id,correct:true,complete:true,reason:'本章知识说明覆盖必要条件与教学目标。'}],questions:['a','b'].map(id=>({id,solvable:true,answerCorrect:true,computedAnswer:'$\\pi$',aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'角系数为2，非零振幅，最小正周期应为π。'}))};
 assert.equal(content.items[1].teachingExplanation,'');
 const saved=validateChapterReview(review,content);assert.deepEqual(saved.questionChecks,review.questions);
 for(const field of ['solvable','answerCorrect']){
  const changed=structuredClone(review);changed.questions[1][field]=false;
  const rejected=validateChapterReview(changed,content);assert.equal(rejected.passed,false);assert.ok(rejected.issues.some(issue=>issue.startsWith('b：')));
  for(const invalid of [undefined,'true',null]){changed.questions[1][field]=invalid;assert.throws(()=>validateChapterReview(changed,content));}
 }
 for(const computedAnswer of [undefined,'','   '])assert.throws(()=>validateChapterReview({...review,questions:[review.questions[0],{...review.questions[1],computedAnswer}]},content));
 assert.equal(saved.questionChecks[1].computedAnswer,'$\\pi$');
});

test('审校文字明确自我纠正却未更新布尔字段时拒绝整份结果，不能静默翻转或放行',()=>{
 const question={id:'a',solvable:true,answerCorrect:true,computedAnswer:'6小时',aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'T=2π/(π/6)=12小时。修正：answerCorrect应为false。'};
 const input={knowledge:[],questions:[question]},practice={...content,knowledge:[],items:[content.items[0]]};
 assert.throws(()=>validateChapterReview(input,practice),/未同步/);
 for(const reason of ['原题答案错误，复算得到12小时。','本题答案本身错误，应当先修复题库。'])assert.throws(()=>validateChapterReview({...input,questions:[{...question,reason}]},practice),/矛盾/);
 assert.throws(()=>validateChapterReview({...input,questions:[{...question,answerCorrect:false,reason:'本题答案本身正确，其他同题的答案有误。'}]},practice),/矛盾/);
 const final={...question,answerCorrect:false,computedAnswer:'12小时',reason:'原题答案错误，T=2π/(π/6)=12小时。'};
 const result=validateChapterReview({...input,questions:[final]},practice);assert.equal(result.passed,false);assert.equal(result.questionChecks[0].answerCorrect,false);
 assert.equal(validateChapterReview({...input,questions:[{...question,computedAnswer:'12小时',reason:'原题答案正确，常见误区是漏掉周期公式分子中的2。'}]},practice).passed,true);
});

 test('学科核查必须全部覆盖、引用原文，不能用笼统通过掩盖错误',()=>{
  const checks=[{id:'period.constant',requirement:'核验振幅与角系数非零条件'}];
  const review={knowledge:[{id,correct:true,complete:true,reason:'定义与公式条件均清楚，覆盖本章知识目标。'}],questions:['a','b'].map(id=>({id,solvable:true,answerCorrect:true,computedAnswer:"$2\\pi$",aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'知识目标一致，例题推导与原题答案相符。'})),checks:[{id:'period.constant',passed:false,evidence:content.knowledge[0].formulas[0].conditions,reason:'需要结合原定义域核对退化为常函数时的最小正周期。'}]};
  assert.equal(validateChapterReview(review,content,checks).passed,false);
  assert.equal(validateChapterReview({...review,checks:[{...review.checks[0],evidence:`'${review.checks[0].evidence}'`}]},content,checks).passed,false);
  assert.throws(()=>validateChapterReview({...review,checks:[{...review.checks[0],evidence:`'${review.checks[0].evidence}'。模型虚构的另一句原话。`}]},content,checks),/逐字引用/);
  assert.throws(()=>validateChapterReview({...review,checks:[]},content,checks),/学科核查/);
  assert.throws(()=>validateChapterReview({...review,checks:[{...review.checks[0],evidence:'本章中不存在的句子'}]},content,checks),/逐字引用/);
 });

test('审校引用编号必须来自当前正文，原文由服务端还原，错误结论仍阻止通过',()=>{
 const checks=[{id:'period.constant',requirement:'核验振幅与角系数非零条件'}];
 const ref='knowledge.0.formulas.0.conditions:0';
 const base={knowledge:[{id,correct:true,complete:true,reason:'定义与公式条件均清楚，覆盖本章知识目标。'}],questions:['a','b'].map(id=>({id,solvable:true,answerCorrect:true,computedAnswer:"$2\\pi$",aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'知识目标一致，例题推导与原题答案相符。'})),checks:[{id:'period.constant',passed:false,evidenceRefs:[ref],reason:'原式退化后的定义域仍需核对，不能直接套用公式。'}]};
 const saved=validateChapterReview(base,content,checks);
 assert.equal(saved.passed,false);assert.deepEqual(saved.checks[0].evidenceRefs,[ref]);
 assert.equal(saved.checks[0].evidence,content.knowledge[0].formulas[0].conditions);
 assert.ok(saved.issues.some(issue=>issue.includes(saved.checks[0].reason)));
 assert.ok(saved.issues.every(issue=>!issue.includes(saved.checks[0].evidence)), 'long quotations stay in expandable checks, not repeated in issue summaries');
 for(const evidenceRefs of [['review.issues:0'],[ref,ref],['knowledge.99.explanation:0'],[]])assert.throws(()=>validateChapterReview({...base,checks:[{...base.checks[0],evidenceRefs}]},content,checks));
 assert.throws(()=>validateChapterReview({...base,checks:[{...base.checks[0],evidenceRefs:[ref,'plan.slots']}]},content,checks),error=>{
  assert.match(error.message,/不存在或重复的原文编号 \["plan.slots"\]/);
  assert.ok(error.message.includes(`可用编号：${JSON.stringify(chapterReviewEvidence(content).map(source=>source.ref))}`));
  assert.match(error.message,/不能因为修复引用而把原有错误判为正确/);return true;
 });
 assert.throws(()=>validateChapterReview({...base,checks:[{...base.checks[0],evidence:'模型自己写的引文'}]},content,checks),/只返回 evidenceRefs/);
 assert.throws(()=>validateChapterReview({...base,checks:[{...base.checks[0],evidenceRefs:undefined}]},content,checks),/缺少原文依据/);
 const withOldReview={...content,review:{issues:['旧审校写下的错误句子']}};
 assert.throws(()=>validateChapterReview({...base,checks:[{...base.checks[0],evidenceRefs:undefined,evidence:'旧审校写下的错误句子'}]},withOldReview,checks),/逐字引用/);
 assert.throws(()=>validateChapterReview({...base,checks:[{...base.checks[0],evidenceRefs:undefined,evidence:content.items[0].selectionReason}]},content,checks),/逐字引用/);
});

test('原文索引保留长公式和跨段上下文全部字符，编号稳定且不含旧审校或元数据',()=>{
 const longContent={...content,knowledge:[{...content.knowledge[0],explanation:'甲'.repeat(699)+'😀'+String.raw` $T=2\\pi/|\\omega|$。`+'乙'.repeat(1500)}],review:{issues:['旧审校意见']},traceId:'trace-secret'};
 const sources=chapterReviewEvidence(longContent),passages=chapterReviewPassages(longContent);
 assert.deepEqual(sources,chapterReviewEvidence(longContent));
 assert.equal(new Set(sources.map(s=>s.ref)).size,sources.length);
 for(const passage of passages)assert.equal(sources.filter(s=>s.path===passage.path).map(s=>s.text).join(''),passage.text);
 for(const source of sources){assert.ok(source.text.length<=700);assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(source.text));}
 assert.ok(sources.every(s=>!s.text.includes('旧审校意见')&&!s.text.includes('trace-secret')));
});

test('跨题审校可引用最多十二段真实正文，仍拒绝重复、虚构引用且保留失败判断',()=>{
 const expanded={...content,introduction:'用于检查跨段证据引用的完整章节。'.repeat(800)};
 const refs=chapterReviewEvidence(expanded).map(source=>source.ref);assert.ok(refs.length>=13);
 const checks=[{id:'curriculum.progression',requirement:'检查全部题目的教学顺序'}];
 const base={knowledge:[{id,correct:true,complete:true,reason:'本章知识说明覆盖必要条件与教学目标。'}],questions:['a','b'].map(id=>({id,solvable:true,answerCorrect:true,computedAnswer:'参考答案',aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'知识目标一致，推导与原题答案相符。'})),checks:[{id:'curriculum.progression',passed:false,evidenceRefs:refs.slice(0,12),reason:'存在超出前置知识的题目，需要进一步调整。'}]};
 const result=validateChapterReview(base,expanded,checks);assert.equal(result.passed,false);assert.equal(result.checks[0].evidenceRefs.length,12);
 for(const evidenceRefs of [refs.slice(0,13),[...refs.slice(0,5),refs[0]],[...refs.slice(0,5),'invented:0']])assert.throws(()=>validateChapterReview({...base,checks:[{...base.checks[0],evidenceRefs}]},expanded,checks));
});
