import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

async function fixture(request, mode='delete') {
 const root=process.env.JIANTI_E2E_DATA_DIR;
 const db=new Database(path.join(root,'teacher-question-bank.sqlite3'));
 const documentId=crypto.randomUUID(), questionId=crypto.randomUUID(), pageId=crypto.randomUUID(), now=new Date().toISOString();
 const storageKey=`documents/${documentId}/page.png`, box={x:10,y:10,width:30,height:20};
 await fs.mkdir(path.join(root,'files','documents',documentId),{recursive:true});
 await fs.writeFile(path.join(root,'files',storageKey),await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><path d="M80 60V220 M40 150H240 M80 180L200 80" stroke="black" fill="none"/></svg>')).png().toBuffer());
 db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,created_at,updated_at) VALUES (?,'local-demo','图片复核测试卷','application/pdf','reviewing',1,'数学',?,?)").run(documentId,now,now);
 db.prepare('INSERT INTO pages (id,document_id,page_number,storage_key,width,height,created_at) VALUES (?,?,1,?,600,800,?)').run(pageId,documentId,storageKey,now);
 db.prepare("INSERT INTO extraction_runs (id,document_id,page_id,page_number,provider,model,status,created_at,finished_at) VALUES (?,?,?,1,'openai-chat-completions','fixture','complete',?,?)").run(crypto.randomUUID(),documentId,pageId,now,now);
 db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,page_number,bbox_json,confidence,needs_human_review,created_at,updated_at) VALUES (?,?,'1','fill','不等式组已转录','0','公式[[image:1]]步骤[[image:2]]坐标图[[image:3]]结论',1,?,0.95,0,?,?)").run(questionId,documentId,JSON.stringify(box),now,now);
 const assets=Array.from({length:4},(_,index)=>({id:crypto.randomUUID(),page:1,kind:'graph',role:index===0?'question':'answer',label:index<3?`误图${index+1}`:'坐标图',bbox:box}));
 for(const [index,a]of assets.entries())db.prepare('INSERT INTO question_assets (id,question_id,page_id,kind,role,label,source_key,crop_key,bbox_json,position,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(a.id,questionId,pageId,a.kind,a.role,a.label,storageKey,storageKey,JSON.stringify(box),index,now);
 let captured, release, notify;
 const seen=new Promise(resolve=>{notify=resolve;});
 const hold=new Promise(resolve=>{release=resolve;});
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  captured=JSON.parse(body);notify();
  if(mode==='stale')await hold;
  const payload={expectedImageCount:1,assets:[{id:`existing:${assets[3].id}`,kind:'graph',role:'answer',label:'坐标图'}],removedAssets:mode==='omit'?[]:assets.slice(0,3).map(a=>({id:a.id,reason:'普通文字或不等式公式，不是图片'})),missingImages:[],unlocatedImages:false,needsHumanReview:false,confidence:0.99,notes:'移除三个公式误图，保留坐标图'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end(`data: ${JSON.stringify({choices:[{delta:{content:JSON.stringify(payload)}}]})}\n\ndata: [DONE]\n\n`);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const config=await request.post('/api/model-profiles',{data:{displayName:`图片复核模拟-${questionId.slice(0,8)}`,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',apiKey:'fixture-key',select:true}});
 if(config.status()!==201){await new Promise(resolve=>server.close(resolve));db.close();throw new Error(await config.text());}
 const draft={id:questionId,number:'1',type:'fill',stem:'不等式组已转录',answer:'0',analysis:'公式[[image:1]]步骤[[image:2]]坐标图[[image:3]]结论',page:1,bbox:box,confidence:0.95,needsHumanReview:false,status:'pending',assets,regions:[],tags:[],options:[]};
 return {documentId,questionId,assets,draft,db,seen,release,get captured(){return captured;},async close(){release();await new Promise(resolve=>server.close(resolve));db.close();}};
}

test('模型接口保留复核证据；审核页手工删除误图后保存正确引用',async({page})=>{
 const f=await fixture(page.request);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(`/review/${f.documentId}`);
  await expect.poll(() => page.getByAltText('原试卷第 1 页').evaluate(img => img.naturalWidth)).toBe(600);
  await expect(page.locator('.confidence-score')).toContainText('95%');
  const response=await page.request.post(`/api/questions/${f.questionId}/review-assets`);
  expect(response.status()).toBe(200);
  const result=await response.json();
  expect(result.removedAssets).toHaveLength(3);
  expect(result.removedAssets.every(a=>a.reason==='普通文字或不等式公式，不是图片')).toBe(true);
  expect(f.db.prepare('SELECT confidence,needs_human_review FROM questions WHERE id=?').get(f.questionId)).toEqual({confidence:0.65,needs_human_review:1});
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM question_assets WHERE question_id=?').get(f.questionId).n).toBe(4);
  await page.reload();
  await expect(page.locator('.confidence-score')).toContainText('65%');
  await page.getByText('图片修正',{exact:true}).click();
  await expect(page.getByRole('button',{name:'AI 复核本题图片'})).toHaveCount(0);
  await page.locator('.question-asset-gallery button').first().click();
  for(let index=0;index<3;index++) await page.getByRole('button',{name:'删除此图',exact:true}).click();
  await page.getByRole('button',{name:'确认入库'}).click();
  await expect(page.getByRole('status').filter({hasText:'已保存，审核通过'})).toBeVisible();
  const saved=f.db.prepare('SELECT confidence,analysis FROM questions WHERE id=?').get(f.questionId);
  expect(saved.confidence).toBe(0.65);expect(saved.analysis).toBe('公式步骤坐标图[[image:1]]结论');
  expect(f.db.prepare('SELECT id FROM question_assets WHERE question_id=?').all(f.questionId)).toEqual([{id:f.assets[3].id}]);
  expect(JSON.stringify(f.captured)).toContain('existingAssets');
  await page.reload();await expect(page.locator('.confidence-score')).toContainText('65%');
  expect(errors).toEqual([]);
 }finally{await f.close();}
});

test('模型遗漏删除决定时拒绝结果，保留全部原图，校验错误和原回复可查',async({page})=>{
 const f=await fixture(page.request,'omit');
 try{
  const response=await page.request.post(`/api/questions/${f.questionId}/review-assets`);
  expect(response.status()).toBe(502);expect((await response.json()).error).toContain('遗漏已有图片');
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM question_assets WHERE question_id=?').get(f.questionId).n).toBe(4);
  const list=await(await page.request.get(`/api/documents/${f.documentId}/model-traces`)).json();
  expect(list.traces[0].status).toBe('failed');
  const files=await(await page.request.get(`/api/documents/${f.documentId}/model-traces/${list.traces[0].id}/content?file=output.txt`)).json();
  expect(files.text).toContain('removedAssets');
 }finally{await f.close();}
});

test('复核期间原图被调整时拒绝过时结果；旧页面保存不能恢复高评分或取消待核查',async({page})=>{
 const f=await fixture(page.request,'stale');
 try{
  const pending=page.request.post(`/api/questions/${f.questionId}/review-assets`);
  await f.seen;f.db.prepare('UPDATE question_assets SET label=? WHERE id=?').run('人工改图',f.assets[0].id);f.release();
  const response=await pending;expect(response.status()).toBe(409);
  expect(f.db.prepare('SELECT label FROM question_assets WHERE id=?').get(f.assets[0].id).label).toBe('人工改图');
  f.db.prepare("UPDATE questions SET confidence=0.4,needs_human_review=1,status='needs_attention' WHERE id=?").run(f.questionId);
  const staleSave=await page.request.put(`/api/questions/${f.questionId}`,{data:f.draft});
  expect(staleSave.status()).toBe(200);
  const saved=(await staleSave.json()).question;expect(saved.confidence).toBe(0.4);expect(saved.needsHumanReview).toBe(true);expect(saved.status).toBe('needs_attention');
 }finally{await f.close();}
});
