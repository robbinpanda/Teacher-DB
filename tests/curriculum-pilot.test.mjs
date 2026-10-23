import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

test('课程样本只复制选中题及裁剪图，保留原题内容，拒绝越界和混入其他用户',()=>{
 mkdirSync('tmp',{recursive:true});
 const root=mkdtempSync(path.resolve('tmp/curriculum-copy-')),source=path.join(root,'source'),planFile=path.join(root,'plan.json');
 const nodeArgs=['--import','./server/register.mjs','--import','tsx'];
 const options={env:{...process.env,JIANTI_DATA_DIR:source,JIANTI_DEPLOYMENT_MODE:'local'},stdio:'pipe',windowsHide:true,timeout:30000};
 execFileSync(process.execPath,[...nodeArgs,'--input-type=module','-e',"const {ensureDatabase}=await import('./db/bootstrap.ts'); await ensureDatabase(); const {getSqlite}=await import('./db/index.ts');getSqlite().close();"],options);
 mkdirSync(path.join(source,'files','crops'),{recursive:true});
 writeFileSync(path.join(source,'files','crops','selected.png'),'selected image');
 writeFileSync(path.join(source,'files','page.png'),'surrounding page');
 writeFileSync(path.join(source,'.model-key-secret'),'test-only-secret');
 const db=new Database(path.join(source,'teacher-question-bank.sqlite3')),now=new Date().toISOString();
 try{
  db.pragma('foreign_keys=ON');
  for(const [id,owner] of [['d','teacher'],['other','other-teacher']])db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,original_key,created_at,updated_at) VALUES(?,?,?,'application/pdf','complete','数学','高三','full.pdf',?,?)").run(id,owner,id,now,now);
  for(const [id,doc] of [['selected','d'],['unselected','d'],['foreign','other']])db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,needs_human_review,page_number,bbox_json,created_at,updated_at) VALUES(?,?,?,'fill',?,'π','周期公式','approved',0,3,'{}',?,?)").run(id,doc,id,`求 sin(2x) 最小正周期 ${id}`,now,now);
  db.prepare("INSERT INTO question_assets(id,question_id,kind,crop_key,source_key,bbox_json,created_at) VALUES('asset','selected','image','crops/selected.png','page.png','{}',?)").run(now);
  db.prepare("INSERT INTO tags VALUES('tag','周期',?)").run(now);db.exec("INSERT INTO question_tags VALUES('selected','tag')");
  db.prepare("INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at) VALUES('secret','teacher','test','openai-compatible','https://example.invalid','test','ciphertext','iv','mask',?,?)").run(now,now);
  const entry={questionId:'selected',documentId:'d',candidateFor:'math.high.trigonometry.period',images:1,stem:'求 sin(2x) 最小正周期 selected'};
  const run=(selection,dest)=>{writeFileSync(planFile,JSON.stringify({selection}));return execFileSync(process.execPath,[...nodeArgs,'scripts/prepare-curriculum-pilot.mts',source,planFile,dest],options);};
  const snapshot=()=>JSON.stringify(['documents','questions','question_assets','tags','question_tags','model_profiles','schema_migrations'].map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
  const before=snapshot(),target=path.join(root,'target');run([entry],target);
  assert.equal(snapshot(),before,'the source database is not migrated or edited');
  assert.equal(existsSync(path.join(target,'.model-key-secret')),false);
  assert.equal(existsSync(path.join(target,'files','page.png')),false);
  assert.equal(readFileSync(path.join(target,'files','crops','selected.png'),'utf8'),'selected image');
  const copy=new Database(path.join(target,'teacher-question-bank.sqlite3'),{readonly:true});
  try{
   assert.deepEqual(copy.prepare('SELECT id,stem,answer,analysis,number,page_number FROM questions').all(),db.prepare("SELECT id,stem,answer,analysis,number,page_number FROM questions WHERE id='selected'").all());
   assert.deepEqual(copy.prepare('SELECT id,original_key FROM documents').all(),[{id:'d',original_key:null}]);
   assert.equal(copy.prepare('SELECT COUNT(*) n FROM model_profiles').get().n,0);
   assert.deepEqual(copy.prepare('SELECT source_key,page_id FROM question_assets').get(),{source_key:null,page_id:null});
   assert.deepEqual(copy.pragma('foreign_key_check'),[]);
   assert.equal(copy.prepare('SELECT COUNT(*) n FROM question_tags').get().n,1);
  }finally{copy.close();}
  const report=JSON.parse(readFileSync(path.join(target,'curriculum-sample.json'),'utf8'));
  assert.equal(report.networkCalls,0);assert.equal(report.questions,1);assert.equal(report.candidateTopicsVerified,false);
  assert.throws(()=>run([entry],target),/EEXIST/);
  assert.throws(()=>run([entry],path.join(source,'nested')),/outside original data/);
  assert.throws(()=>run([entry,entry],path.join(root,'duplicate')),/Duplicate/);
  assert.throws(()=>run([{...entry,stem:'changed'}],path.join(root,'changed')),/stem changed/);
  assert.throws(()=>run([{...entry,images:0}],path.join(root,'missing')),/images changed/);
  assert.throws(()=>run([entry,{...entry,questionId:'foreign',documentId:'other',images:0,stem:undefined}],path.join(root,'foreign')),/Cross-owner/);
  db.prepare("UPDATE question_assets SET crop_key='../escape.png'").run();
  assert.throws(()=>run([entry],path.join(root,'escape')),/outside source files/);
  assert.equal(existsSync(path.join(root,'escape','curriculum-sample.json')),false);
 }finally{db.close();}
});
