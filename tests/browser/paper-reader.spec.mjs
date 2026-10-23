import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';

test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'local-demo' } });
async function fixture() {
 const db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3'));
 const stamp=new Date().toISOString(),doc=crypto.randomUUID(),ids=[];
 db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES (?,'local-demo','导出分页回归','application/pdf','complete','数学','九年级',?,?)").run(doc,stamp,stamp);
 const key=`documents/${doc}/diagram.png`,dir=path.join(process.env.JIANTI_E2E_DATA_DIR,'files','documents',doc);await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'diagram.png'),await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="210"><rect width="300" height="210" fill="white"/><path d="M10 190 L150 10 L290 190 Z" fill="none" stroke="black" stroke-width="2"/></svg>')).png().toBuffer());
 for(let i=0;i<11;i++){
  const id=crypto.randomUUID();ids.push(id);
  const stem=i<8?`已知 $x=${i+1}$，求 $x+1$ 的值：____。`:'如图，在直角三角形中，已知两条边的长度。\n（1）证明给定的两条线段相等；\n（2）求三角形的面积，并写出推导过程。';
  db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES (?,?,?,?,?,'参考答案','解析内容','approved',1,'{}',?,?)").run(id,doc,String(i+1),i<8?'fill':'answer',stem,stamp,stamp);
  if([2,5,8].includes(i))for(let j=0;j<(i===8?2:1);j++)db.prepare("INSERT INTO question_assets (id,question_id,kind,role,label,crop_key,bbox_json,created_at) VALUES (?,?,'figure','question','三角形',?,'{}',?)").run(crypto.randomUUID(),id,key,stamp);
 }
 db.close();return {doc,ids};
}
async function geometry(page) {
 const paper=page.locator('.printable-paper');await expect(paper).toHaveAttribute('data-pagination-ready','true');
 await expect.poll(()=>paper.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
 const sheets=await paper.locator('.paper-paginated').evaluateAll(els=>els.map(e=>{
  const r=e.getBoundingClientRect(),style=getComputedStyle(e),bottom=r.bottom-parseFloat(style.paddingBottom)-(e.querySelector('footer')?.getBoundingClientRect().height??0);
  const questions=[...e.querySelectorAll('.paper-question')].map(q=>({top:q.getBoundingClientRect().top,bottom:q.getBoundingClientRect().bottom,id:q.dataset.questionId,blank:q.querySelector('.answer-space')?.getBoundingClientRect().height??0,answer:q.classList.contains('paper-answer-question'),continuation:q.hasAttribute('data-continuation')}));
  return {height:r.height,bottom,halfPage:(bottom-r.top-parseFloat(style.paddingTop)-1)/2,questions};
 }));
 for(const sheet of sheets){expect(sheet.height).toBeLessThan(1123);expect(sheet.questions.length).toBeGreaterThan(0);for(const q of sheet.questions)expect(q.bottom).toBeLessThanOrEqual(sheet.bottom+1);for(let i=1;i<sheet.questions.length;i++)expect(sheet.questions[i].top).toBeGreaterThanOrEqual(sheet.questions[i-1].bottom-.5);}
 const writing = new Map();
 for(const sheet of sheets)for(const q of sheet.questions)if(q.answer)writing.set(q.id,(writing.get(q.id)??0)+q.blank);
 for(const total of writing.values())expect(total).toBeGreaterThanOrEqual(sheets[0].halfPage-1);
 // A labelled writing continuation is valid; an orphan footer is not.
 return sheets.length;
}
async function checkPdf(bytes,count) {
 const task=getDocument({data:new Uint8Array(bytes)});const pdf=await task.promise;
 expect(pdf.numPages).toBe(count);
 for(let i=1;i<=pdf.numPages;i++){
  const text=(await (await pdf.getPage(i)).getTextContent()).items.map(item=>item.str).join('');
  expect(text).toMatch(/\d+\.|第\s*\d+\s*题作答区/); // A footer alone must never create a page.
  expect(text).not.toContain('返回试卷库');
 }
 await task.destroy();
}

test('原卷阅读与紧凑模板实际PDF均无空白页、页脚孤页和越界',async({page,request})=>{
 test.setTimeout(90000);
 const {doc,ids}=await fixture();
 await page.goto(`/papers/uploaded/${doc}`);const count=await geometry(page);
 await expect(page.locator('.printable-paper .paper-question-line > b')).toHaveText(ids.map((_,i)=>`${i+1}.`));
 await page.emulateMedia({media:'print'});await geometry(page);await checkPdf(await page.pdf({preferCSSPageSize:true,printBackground:true}),count);
 await page.emulateMedia({media:'screen'});
 for(const compact of [true,false]){
  const id=crypto.randomUUID();const saved=await request.post('/api/papers',{data:{id,title:'分页回归练习卷',questionIds:ids,settings:{templateId:'preset-homework',compact,notice:'独立完成，写清必要步骤。',infoFields:['姓名','日期'],style:{questionGap:4,showPageNumber:true},sections:[{id:'fill',title:'一、基础练习',acceptedTypes:['fill'],defaultScore:5,questionIds:ids.slice(0,8)},{id:'answer',title:'二、综合练习',acceptedTypes:['answer'],defaultScore:10,questionIds:ids.slice(8)}]}}});
  expect(saved.status()).toBe(201);
  await page.goto(`/papers/${id}/preview`);const pages=await geometry(page);
  const response=await request.get(`/api/papers/${id}/pdf`,{timeout:65000});expect(response.status()).toBe(200);const pdfBytes=await response.body();await checkPdf(pdfBytes,pages);
  await mkdir('tmp/paper-writing-space',{recursive:true});
  await writeFile(`tmp/paper-writing-space/${compact?'compact':'formal'}.pdf`,pdfBytes);
  await page.locator('.printable-paper .paper-paginated').last().screenshot({path:`tmp/paper-writing-space/${compact?'compact':'formal'}-last.png`});
  await page.emulateMedia({media:'print'});
  expect(await page.locator('html').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({media:'screen'});
 }
 const forbidden=await request.get(`/papers/uploaded/${doc}`,{headers:{'oai-authenticated-user-id':'another-teacher'}});expect(forbidden.status()).toBe(404);
 await page.goto(`/papers/uploaded/${doc}?answers=1`);await expect(page.locator('.printable-paper')).toHaveAttribute('data-pagination-ready','true');
 await expect(page.locator('.printable-paper .printable-answer')).toHaveCount(11);await expect(page.locator('.printable-paper .answer-space')).toHaveCount(0);
});
