import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringSupply} from '../lib/authoring-supply.ts';
import {fingerprintRow} from '../lib/knowledge-retrieval.ts';
const scope={subject:'数学',stage:'high'},root='math.high.trigonometry',period=root+'.period',identity=root+'.identity';
const classification={knowledge:[{id:period,evidence:'题目直接要求计算最小正周期。'},{id:identity,evidence:'需要通过恒等变换合并三角表达式。'}],methods:['公式变形'],competencies:['数学运算'],difficulty:2,difficultyReason:'合并表达式后直接应用周期公式。',prerequisites:[],confidence:.9};
function row(id,status='suggested',extra={}) {const r={id,type:'fill',stem:`求第${id}个函数的最小正周期。`,answer:'π',analysis:'利用周期公式计算',optionsJson:'[]',documentId:'d',documentName:'试卷',grade:'高一',tagsJson:'[]',assetsJson:'[]',classificationJson:JSON.stringify(classification),classificationFingerprint:null,classificationStatus:status,...extra};r.classificationFingerprint=fingerprintRow(r,scope);return r;}
test('规划供给区分建议和确认，去重，排除结构错误，不用过期或未知标签推算难度',()=>{
 const confirmed=row('a','confirmed'),duplicate={...confirmed,id:'a-copy',classificationStatus:'suggested'};
 const stale={...row('stale'),answer:'changed'},unknown=row('unknown',null,{classificationJson:null});
 const malformed=row('bad','confirmed',{type:'single',optionsJson:'[]'});
 const result=authoringSupply([duplicate,row('b'),confirmed,stale,unknown,malformed],scope,[period,identity]);
 assert.equal(result.eligibleUnique,4);assert.equal(result.duplicates,1);assert.equal(result.excludedStructure,1);assert.equal(result.unknownDifficulty,2);
 for(const topic of result.knowledge){assert.equal(topic.difficulties[0].confirmed+topic.difficulties[0].suggested,0);assert.equal(topic.difficulties[1].confirmed,1);assert.equal(topic.difficulties[1].suggested,1);assert.deepEqual(topic.difficulties[1].types,{fill:2});}
 assert.equal(result.knowledge.length,2);assert.ok(!JSON.stringify(result).includes(confirmed.stem),'planner receives counts, not question text');
});
test('完整父考点展开到所有叶节点，空库仍报告零供给而不缩小范围',()=>{
 const result=authoringSupply([],scope,[root]);assert.equal(result.knowledge.length,14);assert.equal(result.eligibleUnique,0);
 assert.ok(result.knowledge.every(k=>k.difficulties.every(d=>d.confirmed===0&&d.suggested===0)));
});
