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
