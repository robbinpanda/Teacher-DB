import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { EducationScope } from '../../lib/education-scope';
import type { AuthoringChapterPlan } from '../../lib/authoring-plan';
import { fingerprintRow, type RetrievalRow, type RetrievalHit } from '../../lib/knowledge-retrieval';
import { validateSelectionCheckpoint, type SelectionCheckpoint } from '../../lib/authoring-candidates';

export function selectionFingerprint(context:unknown,scope:EducationScope,rows:RetrievalRow[],lists:RetrievalHit[][]) {
  const hash=createHash('sha256').update('selection-v3-question-structure\n').update(JSON.stringify(context));
  const ids=new Set(lists.flatMap(list=>list.map(hit=>hit.id)));
  hash.update(JSON.stringify(lists.map(list=>list.map(hit=>hit.id))));
  for(const row of rows.filter(row=>ids.has(row.id)).sort((a,b)=>a.id.localeCompare(b.id)))hash.update(JSON.stringify([
    row.id,row.type,row.documentId,row.documentName,row.grade,row.tagsJson,fingerprintRow(row,scope),row.classificationJson,row.classificationFingerprint,row.classificationStatus,
  ]));
  return hash.digest('hex');
}

export function loadSelectionCheckpoint(db:Database.Database,chapterId:string,fingerprint:string,lists:RetrievalHit[][],slots:AuthoringChapterPlan['slots']) {
  const row=db.prepare('SELECT fingerprint,state_json FROM authoring_selection_checkpoints WHERE chapter_id=?').get(chapterId) as {fingerprint:string;state_json:string}|undefined;
  if(!row)return {};
  if(row.fingerprint!==fingerprint)return {resetReason:'题库、章节计划或模型设置已变化，本次重新比较候选。'};
  try{return {resume:validateSelectionCheckpoint(JSON.parse(row.state_json),lists,slots)};}
  catch{return {resetReason:'先前选题进度无法校验，本次重新比较候选。'};}
}

export function saveSelectionCheckpoint(db:Database.Database,chapterId:string,token:string,fingerprint:string,state:SelectionCheckpoint) {
  db.transaction(()=>{
    const row=db.prepare("SELECT project_id FROM authoring_chapters WHERE id=? AND lease_owner=? AND status='running'").get(chapterId,token) as {project_id:string}|undefined;
    if(!row)throw new Error('任务已被其他进程接管');
    const now=new Date().toISOString();
    db.prepare(`INSERT INTO authoring_selection_checkpoints(chapter_id,fingerprint,state_json,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(chapter_id) DO UPDATE SET fingerprint=excluded.fingerprint,state_json=excluded.state_json,updated_at=excluded.updated_at`).run(chapterId,fingerprint,JSON.stringify(state),now);
    db.prepare('UPDATE authoring_chapters SET revision=revision+1,updated_at=? WHERE id=?').run(now,chapterId);
    db.prepare('UPDATE authoring_projects SET updated_at=? WHERE id=?').run(now,row.project_id);
  }).immediate();
}
