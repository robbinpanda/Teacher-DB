import { readFileSync } from 'node:fs';
import { getSqlite } from '../db/index.ts';
import { extractDocument } from '../server/services/extraction.ts';
import { finalizeDocument } from '../server/services/document-finalize.ts';
import { closePreprocessingWorkers } from '../lib/extraction-preprocessing.ts';
const db=getSqlite(), audit=JSON.parse(readFileSync('tmp/stuck-document-content-audit.json','utf8'));
const ids=[...new Set(JSON.parse(readFileSync('tmp/stuck-page-repair-plan.json','utf8')).map(p=>p.document_id))].filter(id=>audit[id].result.kind==='paper');
await Promise.all(ids.map(async id=>{
 for(let attempt=1;attempt<=3;attempt++){
  const outcome=await extractDocument('local-demo',{documentId:id});
  console.log(JSON.stringify({id,attempt,status:outcome.status,error:outcome.body.error,saved:outcome.body.savedQuestionCount}));
  if(outcome.status===200){const done=await finalizeDocument('local-demo',id);console.log(JSON.stringify({id,finalized:done.status}));return;}
  if(outcome.body.retryable===false)break;
 }
}));await closePreprocessingWorkers();db.close();
