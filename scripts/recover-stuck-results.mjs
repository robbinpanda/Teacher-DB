import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { getSqlite } from '../db/index.ts';
import { getDocumentIntegrity } from '../lib/document-integrity.ts';
import { extractDocument } from '../server/services/extraction.ts';
import { finalizeDocument } from '../server/services/document-finalize.ts';
import { closePreprocessingWorkers } from '../lib/extraction-preprocessing.ts';
const db=getSqlite(), owner='local-demo';
const backup=JSON.parse(readFileSync('tmp/stuck-recovery-backup.json','utf8')).dir;
const audit=JSON.parse(readFileSync('tmp/stuck-document-content-audit.json','utf8'));
const ids={ 'd26502d2-d28a-478b-9e21-747c6f88c57e':21,'a3d1b57b-097a-4e85-9c80-b71ba9c8c8af':21,'ecb09937-f28c-438d-8a6f-5be3512301ee':21,'c5b1c20e-abbd-4d8e-97f3-0cfe957c14f9':78 };
const anthology='c5b1c20e-abbd-4d8e-97f3-0cfe957c14f9';
const source=JSON.parse(readFileSync('tmp/stuck-pdf-text.json','utf8')).find(x=>x.id===anthology);
const printed=source.pages.flatMap((text,i)=>text.split('\n').filter(x=>/^\d+\s*[（(][^）)]*2017/.test(x)).map(text=>({page:i+1,text})));
assert.equal(printed.length,78);
const saved=db.prepare('SELECT * FROM questions WHERE document_id=? ORDER BY CAST(number AS INTEGER)').all(anthology);
const ref=text=>text.match(/[（(]([^）)]+2017[^）)]+)[）)]/)?.[1].replace(/\s/g,'');
for(let i=0;i<78;i++){assert.equal(saved[i].page_number,printed[i].page);assert.equal(ref(saved[i].stem),ref(printed[i].text));}
const removed=[];
db.transaction(()=>{
 for(const [id,total] of Object.entries(ids)){
  assert.ok(!db.prepare("SELECT 1 FROM document_jobs WHERE document_id=? AND status='processing'").get(id));
  if(id!==anthology)assert.equal(audit[id].result.questionCount,total);
  const extras=db.prepare('SELECT * FROM questions WHERE document_id=? AND CAST(number AS INTEGER)>?').all(id,total);
  assert.ok(extras.every(q=>q.status!=='approved'),'Do not remove user-approved work');removed.push(...extras);
  db.prepare('DELETE FROM questions WHERE document_id=? AND CAST(number AS INTEGER)>?').run(id,total);
  db.prepare('UPDATE document_jobs SET question_total=? WHERE document_id=?').run(total,id);
 }
})();
writeFileSync(backup+'/removed-extra-questions.json',JSON.stringify(removed,null,2));
for(const [id,total] of Object.entries(ids)){
 const outcome=await extractDocument(owner,{documentId:id},{records:[{event:'meta',questionCount:total},{event:'done'}],evidence:{reason:'原页与独立核对确认全部题目已保存，补齐处理完成状态；删除额外或重复编号',sourceAudit:audit[id],verifiedTotal:total,backup}});
 assert.equal(outcome.status,200,JSON.stringify(outcome.body));
 const finalized=await finalizeDocument(owner,id);assert.equal(finalized.status,200,JSON.stringify(finalized.body));console.log(JSON.stringify({recovered:id,total}));
}
const uploadFailures=db.prepare("SELECT id FROM documents WHERE status='failed' AND error LIKE '%已有识别结果，不能用不同图片覆盖%'").all();
for(const {id} of uploadFailures){assert.ok(getDocumentIntegrity(db,id)?.reviewReady);const outcome=await finalizeDocument(owner,id);assert.equal(outcome.status,200);console.log(JSON.stringify({restoredUploadStatus:id}));}
const answerSources={ 'be4a6e25-3a18-4ade-a173-f136de749252':'47cf554e-1b8a-4a25-8aac-9b315dd2fee9','1148bc5f-da19-4acb-92b6-04291363df1c':'5dedff38-b0ea-4a88-9644-6f74545f921b','7876c701-4748-44f6-babf-7b9a9775434a':'24b6eb9e-b537-4e8f-b6f2-0c6d507647cb'};
for(const [id,original] of Object.entries(answerSources)){
 assert.equal(audit[id].result.kind,'answers_only');const parent=db.prepare('SELECT name,status FROM documents WHERE id=?').get(original);assert.equal(parent.status,'complete');
 const message=`仅参考答案，无完整题干；对应原卷已入库：${parent.name}。原卷ID：${original}。已停止无效重试，答案文件保留。`;
 db.transaction(()=>{assert.ok(!db.prepare("SELECT 1 FROM document_jobs WHERE document_id=? AND status='processing'").get(id));
  db.prepare("UPDATE extraction_runs SET status='paused',error=?,error_code='source_only',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=NULL WHERE document_id=? AND status<>'complete'").run(message,id);
  db.prepare("UPDATE document_jobs SET status='paused',stream_phase='paused',stream_message=?,last_error=?,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=NULL WHERE document_id=?").run(message,message,id);
  db.prepare("UPDATE documents SET status='failed',error=? WHERE id=?").run(message,id);
  db.prepare("UPDATE questions SET status='needs_attention',needs_human_review=1 WHERE document_id=? AND status<>'approved'").run(id);
 })();console.log(JSON.stringify({answerSourceRetained:id,original}));
}
console.log(JSON.stringify({removedExtraQuestions:removed.length,restoredUploadStatuses:uploadFailures.length}));
await closePreprocessingWorkers();db.close();
