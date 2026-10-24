import { randomUUID } from "node:crypto";
import { getSqlite } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import type { EducationScope } from "../../lib/education-scope";
import type { ClassificationBatch, ClassificationBatchItem } from "../../lib/classification-batch";
import type { QuestionClassification } from "../../lib/question-classification";
import { fingerprintRow, loadRetrievalRows, rankQuestions } from "../../lib/knowledge-retrieval";
import { resolveModelProfile } from "../../lib/model-profiles";
import { classifyQuestion, saveClassification } from "./question-classification";

const time=()=>new Date().toISOString(), lease=()=>new Date(Date.now()+180_000).toISOString();
type BatchRow={id:string;owner_id:string;subject:string;stage:EducationScope["stage"];status:ClassificationBatch["status"];revision:number;profile_id:string;created_at:string;updated_at:string};
function rowFor(owner:string,scope:EducationScope,id:string) {
  return getSqlite().prepare("SELECT * FROM classification_batches WHERE id=? AND owner_id=? AND subject=? AND stage=?").get(id,owner,scope.subject,scope.stage) as BatchRow|undefined;
}
export function listClassificationBatches(owner:string,scope:EducationScope) {
  return getSqlite().prepare(`SELECT b.id,b.status,b.created_at AS createdAt,b.updated_at AS updatedAt,COUNT(i.id) AS total,
    SUM(CASE WHEN i.status IN ('complete','skipped') THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN i.status='failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN i.status='running' THEN 1 ELSE 0 END) AS running
    FROM classification_batches b JOIN classification_batch_items i ON i.batch_id=b.id WHERE b.owner_id=? AND b.subject=? AND b.stage=? GROUP BY b.id ORDER BY b.created_at DESC LIMIT 20`).all(owner,scope.subject,scope.stage) as Array<{id:string;status:string;createdAt:string;updatedAt:string;total:number;completed:number;failed:number;running:number}>;
}
export function readClassificationBatch(owner:string,scope:EducationScope,id:string):ClassificationBatch|null {
  const batch=rowFor(owner,scope,id);if(!batch)return null;
  const rows=getSqlite().prepare("SELECT id,question_id AS questionId,position,status,error,attempt,fingerprint FROM classification_batch_items WHERE batch_id=? ORDER BY position").all(id) as ClassificationBatchItem[];
  const questions=loadRetrievalRows(getSqlite(),owner,scope,undefined,rows.map(row=>row.questionId));
  const hits=new Map([0,100].flatMap(offset=>rankQuestions(questions,scope,{limit:100,offset}).hits).map(hit=>[hit.id,hit]));
  return {id,status:batch.status,revision:batch.revision,profileId:batch.profile_id,createdAt:batch.created_at,updatedAt:batch.updated_at,
    items:rows.map(row=>{const question=questions.find(q=>q.id===row.questionId),hit=hits.get(row.questionId);return {...row,stem:question?.stem??null,documentName:question?.documentName??null,
      fingerprint:question?fingerprintRow(question,scope):row.fingerprint,classification:hit?.classification??null,classificationStatus:hit?.classificationStatus??"unclassified",imageCount:question?JSON.parse(question.assetsJson).length:0};})};
}
function progress(id:string) {
  const rows=getSqlite().prepare("SELECT status FROM classification_batch_items WHERE batch_id=?").all(id) as {status:string}[];
  const status=rows.some(row=>["pending","running"].includes(row.status))?"running":rows.some(row=>row.status==='failed')?"needs_attention":"complete";
  getSqlite().prepare("UPDATE classification_batches SET status=CASE WHEN status='paused' THEN status ELSE ? END,revision=revision+1,updated_at=? WHERE id=?").run(status,time(),id);
}
export async function createClassificationBatch(owner:string,scope:EducationScope,ids:string[],profileId?:string) {
  await ensureDatabase();
  if(!ids.length||ids.length>200||new Set(ids).size!==ids.length)throw new Error("一次请选择 1–200 道不重复题目");
  const profile=await resolveModelProfile(owner,profileId),db=getSqlite();
  const id=randomUUID();
  db.transaction(()=>{
    const rows=loadRetrievalRows(db,owner,scope,undefined,ids);
    if(rows.length!==ids.length)throw new Error("部分题目不存在、未审核或不在当前教学范围");
    const byId=new Map(rows.map(row=>[row.id,row]));
    const valid=new Set([0,100].flatMap(offset=>rankQuestions(rows,scope,{limit:100,offset}).hits).filter(hit=>hit.classification).map(hit=>hit.id));
    db.prepare("INSERT INTO classification_batches(id,owner_id,subject,stage,profile_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id,owner,scope.subject,scope.stage,profile.id,time(),time());
    const insert=db.prepare("INSERT INTO classification_batch_items(id,batch_id,question_id,fingerprint,position,status,updated_at) VALUES(?,?,?,?,?,?,?)");
    ids.forEach((questionId,index)=>insert.run(randomUUID(),id,questionId,fingerprintRow(byId.get(questionId)!,scope),index,valid.has(questionId)?"skipped":"pending",time()));
    progress(id);
  })();
  return readClassificationBatch(owner,scope,id)!;
}
export function controlClassificationBatch(owner:string,scope:EducationScope,id:string,revision:number,action:"pause"|"resume"|"retry") {
  return getSqlite().transaction(()=>{
    const row=rowFor(owner,scope,id),db=getSqlite();
    if(!row)throw new Error("标注任务不存在");
    if(row.revision!==revision)throw new Error("任务进度已变化，请刷新后重试");
    if(action==='pause'&&row.status!=='running'||action==='resume'&&row.status!=='paused')throw new Error("当前任务状态不支持该操作");
    if(action==='retry'){
      const failed=db.prepare("SELECT id,question_id FROM classification_batch_items WHERE batch_id=? AND status='failed'").all(id) as {id:string;question_id:string}[];
      if(!failed.length)throw new Error("没有失败题目需要重试");
      const rows=loadRetrievalRows(db,owner,scope,undefined,failed.map(item=>item.question_id));
      for(const item of failed){const question=rows.find(q=>q.id===item.question_id);if(question)db.prepare("UPDATE classification_batch_items SET status='pending',fingerprint=?,error=NULL,updated_at=? WHERE id=?").run(fingerprintRow(question,scope),time(),item.id);}
    }
    db.prepare("UPDATE classification_batches SET status=?,revision=revision+1,updated_at=? WHERE id=?").run(action==='pause'?"paused":"running",time(),id);
    if(action!=='pause')progress(id);
    return readClassificationBatch(owner,scope,id)!;
  })();
}
export function confirmClassificationBatch(owner:string,scope:EducationScope,id:string,items:Array<{questionId:string;fingerprint:string;classification:QuestionClassification}>) {
  if(!items.length||items.length>200||new Set(items.map(item=>item.questionId)).size!==items.length)throw new Error("请选择 1–200 道已核对的题目");
  return getSqlite().transaction(()=>{
    const batch=readClassificationBatch(owner,scope,id);if(!batch)throw new Error("标注任务不存在");
    for(const item of items){
      const current=batch.items.find(row=>row.questionId===item.questionId);
      if(!current||!["complete","skipped"].includes(current.status)||!current.classification||current.fingerprint!==item.fingerprint||JSON.stringify(current.classification)!==JSON.stringify(item.classification))throw new Error("所选题目或标签已变化，请重新查看再确认");
      saveClassification(owner,scope,item.questionId,item.fingerprint,item.classification,"confirmed");
    }
    return readClassificationBatch(owner,scope,id)!;
  })();
}
export async function kickClassificationBatch() {
  await ensureDatabase();const db=getSqlite(),token=randomUUID(),now=time();
  const job=db.transaction(()=>{
    const row=db.prepare(`SELECT i.id,i.batch_id,i.question_id,i.fingerprint,b.owner_id,b.subject,b.stage,b.profile_id FROM classification_batch_items i JOIN classification_batches b ON b.id=i.batch_id
      WHERE b.status='running' AND (i.status='pending' OR (i.status='running' AND i.lease_expires_at<?))
      AND NOT EXISTS(SELECT 1 FROM classification_batch_items busy JOIN classification_batches parent ON parent.id=busy.batch_id WHERE busy.question_id=i.question_id AND parent.owner_id=b.owner_id AND busy.status='running' AND busy.lease_expires_at>=?)
      ORDER BY b.created_at,i.position LIMIT 1`).get(now,now) as {id:string;batch_id:string;question_id:string;fingerprint:string;owner_id:string;subject:string;stage:EducationScope["stage"];profile_id:string}|undefined;
    if(!row)return;
    db.prepare("UPDATE classification_batch_items SET status='running',attempt=attempt+1,error=NULL,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=?").run(token,lease(),now,row.id);return row;
  })();if(!job)return;
  const scope={subject:job.subject,stage:job.stage};
  const heartbeat=setInterval(()=>db.prepare("UPDATE classification_batch_items SET lease_expires_at=? WHERE id=? AND lease_owner=? AND status='running'").run(lease(),job.id,token),30000);heartbeat.unref();
  const owned=()=>{if(!db.prepare("SELECT 1 FROM classification_batch_items WHERE id=? AND lease_owner=? AND status='running'").get(job.id,token))throw new Error("任务已由其他进程接管");};
  try {
    const question=loadRetrievalRows(db,job.owner_id,scope,undefined,[job.question_id])[0];
    if(!question||fingerprintRow(question,scope)!==job.fingerprint)throw new Error("题目在排队后已变化，请重新核对后重试");
    const existing=rankQuestions([question],scope).hits[0]?.classification;
    if(!existing)await classifyQuestion(job.owner_id,scope,job.question_id,job.profile_id,owned,()=>{
      const batch=db.prepare("SELECT status FROM classification_batches WHERE id=?").get(job.batch_id) as {status:string}|undefined;
      if(batch?.status!=='running')throw new Error("批量标注已暂停，请继续后重试未完成题目");
    });
    db.transaction(()=>{owned();db.prepare("UPDATE classification_batch_items SET status=?,error=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").run(existing?"skipped":"complete",time(),job.id);progress(job.batch_id);})();
  } catch(error) {
    const changed=db.prepare("UPDATE classification_batch_items SET status='failed',error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='running'").run(error instanceof Error?error.message.slice(0,1500):"标注失败",time(),job.id,token);
    if(changed.changes)progress(job.batch_id);
  } finally {clearInterval(heartbeat);}
}
