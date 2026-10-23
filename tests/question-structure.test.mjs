import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectQuestionStructure as inspect,hasQuestionStructureErrors as blocked} from '../lib/question-structure.ts';
import {fingerprintRow,rankQuestions} from '../lib/knowledge-retrieval.ts';
import {chapterCandidateInventory} from '../lib/authoring-candidates.ts';
const options=[{key:'A',content:'π'},{key:'B',content:'2π'}],base={type:'single',stem:'求最小正周期。',answer:'A',options};
const scope={subject:'数学',stage:'high'},period='math.high.trigonometry.period';
const profile={knowledge:[{id:period,evidence:'题干要求最小正周期'}],methods:['公式变形'],competencies:['数学运算'],difficulty:2,difficultyReason:'直接代入公式即可求解。',prerequisites:[],confidence:.9};
const slot={role:'example',knowledgeIds:[period],difficulty:2,type:'any',count:1,score:0,purpose:'计算最小正周期'};
const row=(id,extra={})=>({id,type:'single',stem:`求 sin(${id}x) 最小正周期。`,answer:'A',analysis:'根据周期公式计算。',optionsJson:JSON.stringify(options),documentId:'doc',documentName:'周期题库',grade:'高三',tagsJson:'[]',assetsJson:'[]',classificationJson:null,classificationFingerprint:null,classificationStatus:null,...extra});

test('明确的选择题结构错误不能被已审核状态或标签掩盖',()=>{
 for(const [change,code] of [[{options:[]},'missing-options'],[{options:[options[0],{key:'Ａ',content:'2π'}]},'duplicate-option-key'],[{answer:'C'},'answer-outside-options'],[{answer:'AB'},'single-with-multiple-answers'],[{answer:'AA'},'repeated-answer-key'],[{stem:''},'empty-stem'],[{options:undefined,optionsJson:'not-json'},'invalid-options']]){
  assert.ok(inspect({...base,...change}).some(issue=>issue.code===code&&issue.severity==='error'),code);
 }
 assert.equal(blocked(base),false);
});

test('不把不定项选择或文本答案误判为确定错误，也不检查数学结论是否正确',()=>{
 const note=inspect({...base,type:'multiple',answer:'$A$'});assert.equal(note.length,1);assert.equal(note[0].severity,'notice');
 assert.equal(blocked({...base,type:'multiple',answer:'A'}),false);
 for(const answer of ['bad','线段 AB','选项A成立，说明如下','（1）A；（2）B',''])assert.equal(blocked({...base,answer}),false,answer);
 assert.equal(blocked({...base,answer:'$AB$',options:[{key:'A',content:'$AB$'},{key:'B',content:'$CD$'}]}),false,'an option value is not necessarily a list of answer labels');
 assert.equal(blocked({...base,type:'fill',answer:'wrong mathematical answer',options:[]}),false);
 assert.ok(inspect({...base,answer:String.raw`答案：$\mathrm{AB}$`}).some(issue=>issue.code==='single-with-multiple-answers'));
});

test('结构问题可检索定位，自动候选和确认供给剔除错误而保留提示项',()=>{
 const rows=[row('good'),row('bad',{optionsJson:JSON.stringify([options[0],options[0]])}),row('notice',{type:'multiple'})];
 for(const item of rows){item.classificationJson=JSON.stringify(profile);item.classificationStatus='confirmed';item.classificationFingerprint=fingerprintRow(item,scope);}
 const all=rankQuestions(rows,scope,{knowledgeIds:[period]});assert.equal(all.total,3);assert.equal(all.difficultyCounts[1].confirmed,2);
 assert.deepEqual(rankQuestions(rows,scope,{structure:'blocked'}).hits.map(hit=>hit.id),['bad']);
 assert.deepEqual(new Set(rankQuestions(rows,scope,{structure:'eligible'}).hits.map(hit=>hit.id)),new Set(['good','notice']));
 const inventory=chapterCandidateInventory(rows,scope,[slot]);assert.deepEqual(new Set(inventory.lists[0].map(hit=>hit.id)),new Set(['good','notice']));assert.deepEqual(inventory.structureExclusions,[{slotIndex:0,count:1}]);
 const fixed={...rows[1],optionsJson:JSON.stringify(options)};
 assert.equal(rankQuestions([fixed],scope,{structure:'blocked'}).total,0);assert.equal(rankQuestions([fixed],scope).hits[0].classificationStatus,'stale');
 assert.equal(chapterCandidateInventory([fixed],scope,[slot]).lists[0].length,1,'repair returns as a candidate, not a falsely confirmed label');
});

test('单条坏 JSON 不使整个检索崩溃，也不能继续使用原确认标签',()=>{
 const q=row('q');q.classificationJson=JSON.stringify(profile);q.classificationStatus='confirmed';q.classificationFingerprint=fingerprintRow(q,scope);
 const broken={...q,optionsJson:'invalid',tagsJson:'invalid'};
 const result=rankQuestions([row('healthy'),broken],scope);assert.equal(result.total,2);assert.equal(result.hits.find(hit=>hit.id==='q').classificationStatus,'stale');
 assert.equal(rankQuestions([broken],scope,{structure:'blocked'}).total,1);assert.equal(chapterCandidateInventory([broken],scope,[slot]).lists[0].length,0);
});
