import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {loadRetrievalRows,fingerprintRow} from '../lib/knowledge-retrieval.ts';

function run(directory,mode,status=0){
 const result=spawnSync(process.execPath,['--import','./server/register.mjs','--import','tsx','scripts/verify-selection-recovery.mts',mode],{env:{...process.env,JIANTI_DATA_DIR:directory,JIANTI_DEPLOYMENT_MODE:'local'},encoding:'utf8',windowsHide:true,timeout:45000});
 assert.equal(result.status,status,`${result.stdout}\n${result.stderr}`);
}
test('真实进程退出后恢复逐批选题，写作失败复用选题，来源/模型/计划/标签变化使旧进度失效',()=>{
 const directory=mkdtempSync(path.resolve('tmp/selection-recovery-'));
 run(directory,'crash',73);
 const file=path.join(directory,'teacher-question-bank.sqlite3');
 let db=new Database(file);
 assert.equal(JSON.parse(db.prepare("SELECT state_json FROM authoring_selection_checkpoints WHERE chapter_id='chapter'").get().state_json).rounds,1);
 db.prepare("UPDATE authoring_chapters SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id='chapter'").run();db.close();
 run(directory,'resume');run(directory,'writer-failure');
 db=new Database(file);db.prepare("UPDATE questions SET answer='changed answer' WHERE id='q000'").run();db.close();run(directory,'invalidate-source');
 db=new Database(file);db.prepare("UPDATE model_profiles SET model='changed-model' WHERE id='model'").run();db.close();run(directory,'invalidate-model');
  db=new Database(file);const chapter=JSON.parse(db.prepare("SELECT plan_json FROM authoring_chapters WHERE id='chapter'").get().plan_json);chapter.teachingNotes='补充单位圆直观解释后再安排练习';const plan=JSON.parse(db.prepare("SELECT plan_json FROM authoring_projects WHERE id='project'").get().plan_json);plan.chapters[0]=chapter;db.prepare("UPDATE authoring_chapters SET plan_json=? WHERE id='chapter'").run(JSON.stringify(chapter));db.prepare("UPDATE authoring_projects SET plan_json=? WHERE id='project'").run(JSON.stringify(plan));db.close();run(directory,'invalidate-plan');
  db=new Database(file);const scope={subject:'数学',stage:'high'},row=loadRetrievalRows(db,'teacher',scope,undefined,['q000'])[0],classification={knowledge:[{id:'math.high.trigonometry.period',evidence:'考查函数周期的条件与计算'}],difficulty:5,difficultyReason:'教师将此题确认成综合高难度题目',methods:['公式变形'],competencies:['数学运算'],prerequisites:[],confidence:.9};
  db.prepare("INSERT INTO question_classifications(question_id,owner_id,fingerprint,catalog_version,content_json,status,created_at,updated_at) VALUES('q000','teacher',?,'fixture',?,'confirmed',?,?)").run(fingerprintRow(row,scope),JSON.stringify(classification),new Date().toISOString(),new Date().toISOString());db.close();run(directory,'invalidate-tags');
 run(directory,'lease-loss');
 const calls=readFileSync(path.join(directory,'selection-calls.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(calls.filter(call=>call.mode==='resume').map(call=>call.round),[2,3,4,5,6]);
 assert.equal(calls.filter(call=>call.mode==='writer-failure').length,0);
 assert.ok(calls.filter(call=>call.mode==='invalidate-model').every(call=>call.model==='changed-model'));
});
for(const mode of ['pause-compat','pause-repair'])test(`暂停阻止后续模型调用：${mode}`,()=>{
 const directory=mkdtempSync(path.resolve('tmp/selection-pause-'));run(directory,mode);
});
