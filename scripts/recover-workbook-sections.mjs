import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getSqlite } from '../db/index.ts';
import { resolveStorageKey } from '../lib/file-storage.ts';
import { prepareExtractionInput, closePreprocessingWorkers } from '../lib/extraction-preprocessing.ts';
import { callVisionModel } from '../lib/vision-model.ts';
import { wholeDocumentSystemPrompt } from '../lib/document-extraction.ts';
import { getTagCatalog } from '../lib/tag-catalog.ts';
import { stageFromGrade } from '../lib/education-taxonomy.ts';
import { extractDocument } from '../server/services/extraction.ts';
import { finalizeDocument } from '../server/services/document-finalize.ts';

const id='8c0daac5-1f69-49b6-b2eb-ab7a8da2422d',owner='local-demo',db=getSqlite();
const document=db.prepare('SELECT * FROM documents WHERE id=?').get(id);
const groups=[[2,3,14],[4,6,14],[7,9,14],[10,12,14],[14,15,14],[16,17,14],[18,20,14],[21,23,14],[24,26,14],[27,29,12],[30,32,11],[33,34,12],[35,37,13],[38,39,14],[41,42,14],[43,44,14],[45,46,14]];
mkdirSync('tmp/workbook-recovery',{recursive:true});
const pages=db.prepare('SELECT page_number AS pageNumber,storage_key FROM pages WHERE document_id=? ORDER BY page_number').all(id);
const prepared=await prepareExtractionInput({pages:pages.map(p=>({pageNumber:p.pageNumber,path:resolveStorageKey(p.storage_key)}))});
const tags=(await getTagCatalog(owner,document.subject||'数学',stageFromGrade(document.grade))).map(t=>t.name);
let cursor=0;const results=[];
await Promise.all(Array.from({length:17},async()=>{
 while(cursor<groups.length){const index=cursor++,[first,last,expected]=groups[index],cache=`tmp/workbook-recovery/section-${index+1}.json`;
  try {
   let result;
   if(existsSync(cache))result=JSON.parse(readFileSync(cache,'utf8'));
   else {const response=await callVisionModel({ownerId:owner,documentId:id,purpose:'page_extraction',jsonMode:true,maxOutputTokens:16000,timeoutMs:180000,
    images:prepared.modelImages.filter(p=>p.page>=first&&p.page<=last),
    system:wholeDocumentSystemPrompt+'\n本次是按章节恢复，输出格式改为单个JSON对象 {"questions":[完整题目对象,...]}，不要输出meta/question/done事件。其余逐字转录、题干/答案分离、图片和不编造规则全部保持。允许标签：'+JSON.stringify(tags),
    text:`这是原文件第${first}到${last}页，一个独立练习小节。请提取实际可见全部题干，按本小节原题号1开始连续输出；先前页面核对预计${expected}题，仍以图像实际内容为准，不能凑数。firstLinePage、sourcePages、answerPages使用图片前的原文件页码${first}..${last}，不得改成从1起的相对页码。本书没有答案，answer和analysis为空并注明原页未提供，不准自行解题。学习目标、章节标题和页码不是题目。候选：${JSON.stringify(prepared.candidates.filter(c=>c.page>=first&&c.page<=last).map(c=>({id:c.id,page:c.page})))}`});
    result={...JSON.parse(response.content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')),traceId:response.traceId};writeFileSync(cache,JSON.stringify(result,null,2));
   }
   assert.equal(result.questions.length,expected,`section ${index+1} count`);
   result.questions.forEach((q,i)=>{assert.equal(String(q.number),String(i+1));assert.ok(q.stem?.trim());assert.ok(q.firstLinePage>=first&&q.firstLinePage<=last);});
   results[index]=result;console.log(JSON.stringify({section:index+1,pages:[first,last],questions:expected}));
  } catch(error){console.log(JSON.stringify({section:index+1,error:error.message}));}
 }
}));
assert.equal(results.filter(Boolean).length,groups.length,'有章节未完整返回；保留缓存，下次仅重试缺失章节');
const questions=results.flatMap((r,index)=>r.questions.map(q=>({...q,_sourceSection:{pages:groups[index].slice(0,2),originalNumber:q.number}}))).map((q,i)=>({...q,number:String(i+1)}));
assert.ok(!db.prepare("SELECT 1 FROM document_jobs WHERE document_id=? AND status='processing'").get(id));
db.prepare('UPDATE document_jobs SET question_total=? WHERE document_id=?').run(questions.length,id);
const outcome=await extractDocument(owner,{documentId:id},{records:[{event:'meta',questionCount:questions.length},...questions.map(question=>({event:'question',question})),{event:'done'}],evidence:{reason:'修复空白渲染后按17个独立小节核对并识别，章首页学习目标不入库；全书连续存储编号，原小节题号保留在_sourceSection',traces:results.map(x=>x.traceId),groups}});
assert.equal(outcome.status,200,JSON.stringify(outcome.body));const finalized=await finalizeDocument(owner,id);assert.equal(finalized.status,200,JSON.stringify(finalized.body));
console.log(JSON.stringify({recovered:id,sections:groups.length,questions:questions.length}));await closePreprocessingWorkers();db.close();
