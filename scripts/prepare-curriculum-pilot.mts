// Local preparation only. No profiles, secrets, jobs, original PDFs or other questions are copied.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,realpath,copyFile} from 'node:fs/promises';
import Database from 'better-sqlite3';
import {ensureDatabase} from '../db/bootstrap.ts';
import {getSqlite} from '../db/index.ts';
import {loadRetrievalRows} from '../lib/knowledge-retrieval.ts';

type Row=Record<string,string|number|bigint|Buffer|null>;
type Entry={questionId:string;documentId:string;candidateFor:string;images:number;stem?:string};
const [sourceArg,planArg,destinationArg]=process.argv.slice(2);
assert.ok(sourceArg&&planArg&&destinationArg,'Usage: prepare-curriculum-pilot.mts <source-data> <sample-plan.json> <new-destination>');
globalThis.fetch=async()=>{throw new Error('Network calls are disabled during local curriculum preparation');};
const sourceRoot=await realpath(path.resolve(sourceArg));
const sourceFiles=await realpath(path.join(sourceRoot,'files'));
const destinationInput=path.resolve(destinationArg);
await mkdir(path.dirname(destinationInput),{recursive:true});
const destination=path.join(await realpath(path.dirname(destinationInput)),path.basename(destinationInput));
const outsideSource=path.relative(sourceRoot,destination);
assert.ok(outsideSource&&(outsideSource.startsWith('..'+path.sep)||path.isAbsolute(outsideSource)),'Destination must be outside original data');
const plan=JSON.parse(await readFile(planArg,'utf8')) as {selection:Entry[]};
assert.ok(Array.isArray(plan.selection)&&plan.selection.length>0&&plan.selection.length<=112,'Select 1–112 questions');
assert.equal(new Set(plan.selection.map(entry=>entry.questionId)).size,plan.selection.length,'Duplicate question IDs');
const source=new Database(path.join(sourceRoot,'teacher-question-bank.sqlite3'),{readonly:true,fileMustExist:true});
const originalVersion=source.prepare('SELECT MAX(version) n FROM schema_migrations').get();
const sourceQuestionCount=(source.prepare('SELECT count(*) n FROM questions').get() as {n:number}).n;
const documents=new Map<string,Row>(),questions:Row[]=[],assets:Row[]=[],files=new Map<string,{source:string;sha256:string}>();
const topics:Record<string,number>={};let owner='';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const academic=(q:Row)=>['id','document_id','number','type','stem','options_json','answer','analysis','page_number','bbox_json','score'].map(key=>q[key]??null);
const sourceHashes:Record<string,string>={};
try{
 for(const entry of plan.selection){
  assert.match(entry.candidateFor,/^math\.high\.trigonometry\.[a-z-]+$/);
  const q=source.prepare('SELECT * FROM questions WHERE id=?').get(entry.questionId) as Row|undefined;
  assert.ok(q&&q.document_id===entry.documentId,'Sample question or source document changed');
  assert.equal(q.status,'approved','Question is not approved');assert.ok(!q.needs_human_review,'Question needs human review');
  assert.ok(!q.parent_question_id&&!q.parent_external_id&&!q.variation_kind,'Sample must contain original bank questions');
  if(entry.stem!==undefined)assert.equal(q.stem,entry.stem,'Question stem changed since sampling');
  const d=source.prepare('SELECT * FROM documents WHERE id=?').get(entry.documentId) as Row;
  assert.ok(d&&d.subject==='数学'&&String(d.grade).startsWith('高'),'Question is outside high-school mathematics');
  if(!owner)owner=String(d.owner_id);assert.equal(d.owner_id,owner,'Cross-owner sample');
  documents.set(entry.documentId,d);questions.push(q);sourceHashes[entry.questionId]=digest(academic(q));
  topics[entry.candidateFor]=(topics[entry.candidateFor]??0)+1;
  const rows=source.prepare('SELECT * FROM question_assets WHERE question_id=? ORDER BY id').all(q.id) as Row[];
  assert.equal(rows.length,entry.images,'Question images changed since sampling');
  for(const asset of rows){
   assert.ok(typeof asset.crop_key==='string'&&asset.crop_key,'Reviewed question crop missing');
   const key=asset.crop_key,relative=path.relative(sourceFiles,path.resolve(sourceFiles,key));
   assert.ok(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)&&!path.isAbsolute(key),'Image path outside source files');
   const resolved=await realpath(path.join(sourceFiles,key)),realRelative=path.relative(sourceFiles,resolved);
   assert.ok(realRelative&&realRelative!=='..'&&!realRelative.startsWith('..'+path.sep)&&!path.isAbsolute(realRelative),'Image link outside source files');
   const bytes=await readFile(resolved);files.set(key,{source:resolved,sha256:createHash('sha256').update(bytes).digest('hex')});assets.push(asset);
  }
 }
 assert.ok(assets.length<=25,'Sample exceeds 25 attached images');
 await mkdir(destination);process.env.JIANTI_DATA_DIR=destination;await ensureDatabase();const target=getSqlite();
 try{
  const insert=(table:string,row:Row)=>{const columns=new Set((target.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name));const keys=Object.keys(row).filter(key=>columns.has(key));target.prepare(`INSERT INTO ${table}(${keys.map(k=>'"'+k.replaceAll('"','""')+'"').join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));};
  target.transaction(()=>{
   for(const doc of documents.values())insert('documents',{...doc,original_key:null,paper_folder_id:null,source_kind:'imported',status:'complete'});
   for(const q of questions)insert('questions',{...q,folder_id:null});
   // Preserve reviewed crops and original question/page numbers without adding the surrounding page or PDF.
   for(const asset of assets)insert('question_assets',{...asset,page_id:null,source_key:null});
   const copiedTags=new Set<string>();
   for(const q of questions)for(const link of source.prepare('SELECT * FROM question_tags WHERE question_id=?').all(q.id) as Row[]){
    const tag=source.prepare('SELECT * FROM tags WHERE id=?').get(link.tag_id) as Row;
    if(!copiedTags.has(String(tag.id))){insert('tags',tag);copiedTags.add(String(tag.id));target.prepare('INSERT OR IGNORE INTO tag_catalog(id,owner_id,subject,stage,name,created_at) VALUES(?,?,\'数学\',\'high\',?,?)').run(randomUUID(),owner,tag.name,new Date().toISOString());}
    insert('question_tags',link);
   }
  }).immediate();
  for(const [key,file] of files){const targetFile=path.join(destination,'files',key);await mkdir(path.dirname(targetFile),{recursive:true});await copyFile(file.source,targetFile);assert.equal(createHash('sha256').update(await readFile(targetFile)).digest('hex'),file.sha256,'Copied crop changed');}
  assert.deepEqual(target.pragma('foreign_key_check'),[]);assert.deepEqual(target.pragma('quick_check'),[{quick_check:'ok'}]);
  assert.equal((target.prepare('SELECT count(*) n FROM model_profiles').get() as {n:number}).n,0,'No credentials/profiles may be copied');
  assert.equal((target.prepare('SELECT count(*) n FROM questions').get() as {n:number}).n,questions.length);
  assert.equal(loadRetrievalRows(target,owner,{subject:'数学',stage:'high'}).length,questions.length,'All sampled questions must remain retrievable');
  for(const q of target.prepare('SELECT * FROM questions').all() as Row[])assert.equal(digest(academic(q)),sourceHashes[String(q.id)],'Question content changed during copy');
  assert.equal((source.prepare('SELECT count(*) n FROM questions').get() as {n:number}).n,sourceQuestionCount);
  assert.deepEqual(source.prepare('SELECT MAX(version) n FROM schema_migrations').get(),originalVersion);
  const report={preparedAt:new Date().toISOString(),directory:destination,owner,questions:questions.length,documents:documents.size,attachedImages:assets.length,files:[...files].map(([key,f])=>({key,sha256:f.sha256})),topics,sourceHashes,
   networkCalls:0,modelProfiles:0,sourceSchema:originalVersion,candidateTopicsVerified:false,
   note:'Local-only subset. Full PDFs, surrounding page images, model profiles, credentials, jobs and unrelated questions are omitted. Candidate topics are unverified. External model use requires separate authorization.'};
  await writeFile(path.join(destination,'curriculum-sample.json'),JSON.stringify(report,null,2));
  await writeFile(path.join(destination,'sample-plan.json'),JSON.stringify(plan,null,2));
  console.log(JSON.stringify({directory:destination,questions:report.questions,documents:report.documents,attachedImages:report.attachedImages,topics,networkCalls:0,modelProfiles:0}));
 }finally{target.close();}
}finally{source.close();}
