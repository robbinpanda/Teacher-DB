import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { knowledgeCatalog, expandKnowledgeIds, resolveKnowledgeTerms } from '../lib/knowledge-catalog.ts';
import { parseClassification } from '../lib/question-classification.ts';
import { fingerprintRow, loadRetrievalRows, rankQuestions } from '../lib/knowledge-retrieval.ts';
import { installAuthoringSchema } from '../lib/authoring-store.ts';

const scope = {subject:'数学',stage:'high'};
const root='math.high.trigonometry', period=`${root}.period`, identity=`${root}.identity`;
const profile={knowledge:[{id:period,evidence:'题干要求求函数的最小正周期。'}],methods:['公式变形'],competencies:['数学运算'],difficulty:2,difficultyReason:'直接识别角系数并代入周期公式即可。',prerequisites:[],confidence:.9};
function row(id,extra={}) {return {id,type:'fill',stem:'求函数 $y=sin(2x)$ 的最小正周期。',answer:'π',analysis:'使用周期公式',optionsJson:null,documentId:'d',documentName:'试卷',grade:'高一',tagsJson:'[]',assetsJson:'[]',classificationJson:null,classificationFingerprint:null,classificationStatus:null,...extra};}
function classified(id,status='confirmed') {const r=row(id,{classificationJson:JSON.stringify(profile),classificationStatus:status});r.classificationFingerprint=fingerprintRow(r,scope);return r;}

test('三角函数式结合题干任务召回候选，未确认线索不充当难度或覆盖标签',()=>{
 for(const [topic,stem] of [
  ['model',String.raw`摩天轮高度为 $h=12-10\cos t$，求指定时刻的高度。`],
  ['parameters',String.raw`将 $y=\sin x$ 向右平移一个单位，写出新的函数。`],
  ['monotonicity',String.raw`求 $y=\sin(2x)$ 的单调递增区间。`],
  ['extrema',String.raw`求 $y=\cos x$ 在指定区间上的值域。`],
  ['graphs',String.raw`求 $y=\sin x$ 图像上的最低点。`],
  ['symmetry',String.raw`判断 $y=\cos x$ 是否为偶函数。`],
  ['same-angle',String.raw`已知 $\tan\theta=2$，求 $\sin\theta+\cos\theta$。`],
  ['same-angle',String.raw`已知 $\sin\frac{\theta}{2}+\cos\frac{\theta}{2}=a$，求值。`],
 ]){
  const candidate=row('q',{stem,analysis:''}),options={knowledgeIds:[`${root}.${topic}`]};
  const result=rankQuestions([candidate],scope,options);
  assert.equal(result.total,1,topic);assert.equal(result.hits[0].evidenceKind,'keyword');
  assert.deepEqual(result.hits[0].matchedKnowledgeIds,[]);assert.ok(result.hits[0].reasons.some(reason=>reason.includes('待核对')));
  assert.equal(result.difficultyCounts.reduce((n,d)=>n+d.classified+d.confirmed,0),0);
  assert.equal(rankQuestions([candidate],scope,{...options,confirmedOnly:true}).total,0);
  assert.equal(rankQuestions([candidate],scope,{...options,difficulty:2}).total,0);
  assert.equal(rankQuestions([candidate],scope,{...options,methods:['公式变形']}).total,0);
 }
});

test('选项中的函数参与发现，但解答中的三角函数不能把几何与对数任务误作三角性质',()=>{
 const choice=row('choice',{stem:'下列函数的最大值为一的是',analysis:'',optionsJson:JSON.stringify([{key:'A',content:String.raw`$y=\sin x$`},{key:'B',content:'$y=x$'}])});
 assert.equal(rankQuestions([choice],scope,{knowledgeIds:[`${root}.extrema`]}).total,1);
 assert.equal(rankQuestions([choice],scope,{query:'sin'}).total,1);
 for(const [topic,stem] of [['graphs','求双曲线的渐近线。'],['symmetry','求点关于直线的对称点。'],['monotonicity','求对数函数的单调区间。']]){
  const candidate=row('q',{stem,analysis:String.raw`辅助计算用到了 $\sin\alpha=1/2$。`});
  assert.equal(rankQuestions([candidate],scope,{knowledgeIds:[`${root}.${topic}`]}).total,0);
 }
 for(const stem of [String.raw`求 $\sin\alpha+\cos\beta$。`,String.raw`求 $\sin(2x)+\cos x$。`,String.raw`求 $\sin(\alpha+\beta)+\cos\alpha$。`]){
  assert.equal(rankQuestions([row('q',{stem,analysis:''})],scope,{knowledgeIds:[`${root}.same-angle`]}).total,0);
 }
 assert.doesNotThrow(()=>rankQuestions([row('q',{optionsJson:'invalid'})],scope));
});

test('知识目录无悬空前置条件，父节点扩展而具体考点不扩展兄弟节点',()=>{
 const nodes=knowledgeCatalog('数学','high'),ids=new Set(nodes.map(n=>n.id));assert.equal(ids.size,nodes.length);
 for(const n of nodes){if(n.parentId)assert.ok(ids.has(n.parentId));for(const p of n.prerequisites)assert.ok(ids.has(p));}
 assert.ok(expandKnowledgeIds([root],nodes).includes(period));assert.deepEqual(expandKnowledgeIds([period],nodes),[period]);
 assert.deepEqual(resolveKnowledgeTerms('三角函数最小正周期',nodes),[period]);
 assert.ok(!knowledgeCatalog('数学','middle').some(n=>n.id===period));
});
test('拒绝跨学段、虚构考点、重复考点及无难度依据的标签',()=>{
 assert.throws(()=>parseClassification(profile,'数学','middle'));
 assert.throws(()=>parseClassification({...profile,knowledge:[{id:'fake',evidence:'具体内容'}]},'数学','high'));
 assert.throws(()=>parseClassification({...profile,knowledge:[...profile.knowledge,...profile.knowledge]},'数学','high'));
 assert.throws(()=>parseClassification({...profile,difficultyReason:''},'数学','high'));
});
test('确认标签优先于模型建议与关键词；模糊字符串不算确认覆盖',()=>{
 const result=rankQuestions([row('keyword'),classified('suggested','suggested'),classified('confirmed')],scope,{knowledgeIds:[period]});
 assert.deepEqual(result.hits.map(h=>h.id),['confirmed','suggested','keyword']);
 assert.deepEqual(result.hits[2].matchedKnowledgeIds,[]);assert.equal(result.hits[2].evidenceKind,'keyword');
 assert.equal(rankQuestions([row('keyword')],scope,{knowledgeIds:[identity]}).total,0);
 const general=rankQuestions([row('a-unclassified'),classified('b-suggested','suggested'),classified('c-confirmed')],scope);
 assert.deepEqual(general.hits.map(h=>h.id),['c-confirmed','b-suggested','a-unclassified']);
 assert.deepEqual(general.hits.map(h=>h.evidenceKind),['confirmed','suggested','keyword']);
});
test('题干、选项、答案、解析或题图变动后不能继续使用旧难度和确认状态',()=>{
 for(const change of [{stem:'另一题'},{optionsJson:'[{"key":"A","content":"2"}]'},{answer:'2π'},{analysis:'新解析'},{assetsJson:'[{"id":"new"}]'}]){
  const changed={...classified('q'),...change};
  assert.equal(rankQuestions([changed],scope,{confirmedOnly:true}).total,0);
  assert.equal(rankQuestions([changed],scope,{difficulty:2}).total,0);
  assert.equal(rankQuestions([changed],scope).hits[0].classificationStatus,'stale');
 }
});
test('多考点 AND、不重复选题、题型与难度约束真实生效',()=>{
 assert.equal(rankQuestions([classified('q')],scope,{knowledgeIds:[period,identity],match:'all'}).total,0);
 assert.equal(rankQuestions([classified('q')],scope,{excludeIds:['q']}).total,0);
 assert.equal(rankQuestions([classified('q')],scope,{types:['answer']}).total,0);
 assert.equal(rankQuestions([classified('q')],scope,{difficulty:4}).total,0);
});
test('方法与能力必须由当前有效标签支持，分页不截断题库覆盖统计',()=>{
 const rows=[classified('q1'),classified('q2','suggested'),row('keyword')];
 assert.equal(rankQuestions(rows,scope,{methods:['公式变形'],competencies:['数学运算']}).total,2);
 assert.equal(rankQuestions(rows,scope,{methods:['公式变形'],confirmedOnly:true}).total,1);
 assert.equal(rankQuestions(rows,scope,{methods:['分类讨论']}).total,0);
 assert.equal(rankQuestions([{...classified('q'),answer:'changed'}],scope,{methods:['公式变形']}).total,0);
 const page=rankQuestions(rows,scope,{methods:['公式变形'],limit:1,offset:1});
 assert.deepEqual(page.hits.map(hit=>hit.id),['q2']);assert.equal(page.total,2);assert.equal(page.pagination.nextOffset,null);
 assert.equal(rankQuestions(rows,scope,{limit:1}).pagination.nextOffset,1);
});
test('SQLite 查询覆盖 2000 条以外的题目，同时强制租户、审核、学段、学科和来源隔离',()=>{
 const db=new Database(':memory:');
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE documents(id TEXT PRIMARY KEY,owner_id TEXT,subject TEXT,grade TEXT,name TEXT);
 CREATE TABLE questions(id TEXT PRIMARY KEY,document_id TEXT,type TEXT,stem TEXT,options_json TEXT,answer TEXT,analysis TEXT,status TEXT);
 CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT); CREATE TABLE question_tags(question_id TEXT,tag_id TEXT);
 CREATE TABLE question_assets(id TEXT,question_id TEXT,crop_key TEXT,source_key TEXT,role TEXT,bbox_json TEXT);`);
 installAuthoringSchema(db);installAuthoringSchema(db);
 for(const [id,owner,subject,grade] of [['d','owner','数学','高一'],['other','other','数学','高一'],['middle','owner','数学','九年级'],['physics','owner','物理','高一']]) db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(id,owner,subject,grade,id);
 const insert=db.prepare("INSERT INTO questions VALUES(?,?,'fill',?,NULL,'π','周期公式',?)");
 db.transaction(()=>{for(let i=0;i<2101;i++)insert.run(`q${i}`,'d',i===2100?'求最小正周期':'普通题','approved');})();
 for(const d of ['other','middle','physics'])insert.run(d,d,'求最小正周期','approved');insert.run('pending','d','求最小正周期','pending');
 const rows=loadRetrievalRows(db,'owner',scope);assert.equal(rows.length,2101);
 assert.deepEqual(rankQuestions(rows,scope,{query:'最小正周期'}).hits.map(h=>h.id),['q2100']);
 assert.deepEqual(loadRetrievalRows(db,'owner',scope,['other']),[]);assert.deepEqual(loadRetrievalRows(db,'owner',scope,[]),[]);
 assert.equal(loadRetrievalRows(db,'other',scope).length,1);
 db.close();
});

 test('指定考点后的补充关键词仍然收窄结果',()=>{
  assert.equal(rankQuestions([classified('q')],scope,{knowledgeIds:[period],query:'不存在的关键词'}).total,0);
  assert.equal(rankQuestions([classified('q')],scope,{knowledgeIds:[period],query:'sin(2x)'}).total,1);
 });
