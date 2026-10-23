import {test,expect} from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';

test.use({extraHTTPHeaders:{'oai-authenticated-user-id':'structure-test'}});
const scope='subject='+encodeURIComponent('数学')+'&stage=high';
test('结构问题可定位修复，提示项不误排除，105份来源检索可用于换题',async({page,context,request})=>{
 await context.addCookies([{name:'teacher-db-scope',value:encodeURIComponent(JSON.stringify({subject:'数学',stage:'high'})),url:'http://127.0.0.1:3189'}]);
 const db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3')),time=new Date().toISOString();
 const docs=Array.from({length:105},()=>crypto.randomUUID()),goodOptions=[{key:'A',content:'π'},{key:'B',content:'2π'}];
 const insert=(id,doc,number,type,options,answer)=>db.prepare("INSERT INTO questions(id,document_id,number,type,stem,options_json,answer,analysis,status,needs_human_review,confidence,page_number,bbox_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'使用周期公式计算。','approved',0,1,1,?, ?,?)").run(id,doc,number,type,`求函数 sin(2x) 的最小正周期。${number}`,JSON.stringify(options),answer,JSON.stringify({x:0,y:0,width:50,height:20}),time,time);
 for(const [i,doc] of docs.entries()){
  db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES(?,'structure-test',?,'application/pdf','complete','数学','高三',?,?)").run(doc,`结构资料 ${i+1}`,time,time);
  insert(crypto.randomUUID(),doc,'1','single',goodOptions,'A');
 }
 const duplicate=crypto.randomUUID(),missing=crypto.randomUUID(),notice=crypto.randomUUID();
 insert(duplicate,docs[0],'2','single',[goodOptions[0],{key:'A',content:'2π'}],'A');
 insert(missing,docs[0],'3','single',[],'A');insert(notice,docs[0],'4','multiple',goodOptions,'A');
 const pageId=crypto.randomUUID(),pageKey=`documents/${docs[0]}/page.png`;
 await mkdir(path.join(process.env.JIANTI_E2E_DATA_DIR,'files','documents',docs[0]),{recursive:true});
 await writeFile(path.join(process.env.JIANTI_E2E_DATA_DIR,'files',pageKey),await sharp({create:{width:800,height:1100,channels:3,background:'white'}}).png().toBuffer());
 db.prepare('UPDATE documents SET page_count=1 WHERE id=?').run(docs[0]);
 db.prepare('INSERT INTO pages(id,document_id,page_number,storage_key,width,height,created_at) VALUES(?,?,1,?,800,1100,?)').run(pageId,docs[0],pageKey,time);
 db.prepare("INSERT INTO extraction_runs(id,document_id,page_id,page_number,provider,model,status,created_at,finished_at) VALUES(?,?,?,1,'openai-chat-completions','fixture','complete',?,?)").run(crypto.randomUUID(),docs[0],pageId,time,time);
 db.close();
 const filtered=await request.post(`/api/knowledge?${scope}`,{data:{documentIds:docs,structure:'eligible',limit:100}});expect(filtered.status()).toBe(200);const eligible=await filtered.json();expect(eligible.total).toBe(106);
 expect((await request.post(`/api/knowledge?${scope}`,{data:{documentIds:[...docs,...Array.from({length:896},()=>crypto.randomUUID())]}})).status()).toBe(400);
 const foreign=await request.post(`/api/knowledge?${scope}`,{headers:{'oai-authenticated-user-id':'other-teacher'},data:{documentIds:docs,structure:'blocked'}});expect((await foreign.json()).total).toBe(0);
 await page.goto('/studio');await page.getByRole('button',{name:'精准选题与标注'}).click();await page.getByRole('combobox',{name:'题目结构',exact:true}).selectOption('blocked');await page.getByRole('button',{name:'检索',exact:true}).click();
 await expect(page.locator('.studio-results article')).toHaveCount(2);await expect(page.locator('.studio-results')).toContainText('选项编号重复');
 await expect(page.locator('.studio-results')).toContainText('不足两个结构化选项');
 const card=page.locator('.studio-results article').filter({hasText:'选项编号重复'});await expect(card.getByRole('link',{name:'打开原题核对与修复'})).toHaveAttribute('href',`/review/${docs[0]}?question=${duplicate}`);
 await card.getByRole('button',{name:'查看题目与标签'}).click();await expect(page.getByRole('region',{name:'题目标注'})).toContainText('结构需修复');
 await mkdir('tmp/teacher-pilot',{recursive:true});await page.screenshot({path:'tmp/teacher-pilot/question-structure-browser.png',fullPage:false});
 const popupPromise=page.waitForEvent('popup');await card.getByRole('link',{name:'打开原题核对与修复'}).click();const editor=await popupPromise;
 await expect(editor.getByRole('button',{name:'第 2 题 · 单选题 · 已入库',exact:true})).toHaveAttribute('aria-current','true');
 await editor.getByRole('button',{name:'编辑选项 LaTeX',exact:true}).click();
 await editor.getByRole('textbox',{name:'第 2 个选项编号',exact:true}).fill('B');
 await editor.getByRole('button',{name:'添加选项',exact:true}).click();await editor.getByRole('textbox',{name:'第 3 个选项内容',exact:true}).fill('临时多余选项');await editor.getByRole('button',{name:'删除第 3 个选项',exact:true}).click();
 await expect(editor.locator('.option-editor-row')).toHaveCount(2);
 await editor.screenshot({path:'tmp/teacher-pilot/question-structure-repair-browser.png',fullPage:false});
 const savedPromise=editor.waitForResponse(response=>response.url().endsWith(`/api/questions/${duplicate}`)&&response.request().method()==='PUT');
 await editor.getByRole('button',{name:'确认入库',exact:true}).click();const saved=await savedPromise;expect(saved.status(),await saved.text()).toBe(200);await editor.close();
 await page.getByRole('region',{name:'题目标注'}).getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'检索',exact:true}).click();await expect(page.locator('.studio-results article')).toHaveCount(1);
 expect((await (await request.post(`/api/knowledge?${scope}`,{data:{documentIds:docs,structure:'eligible'}})).json()).total).toBe(107);
 const noticeDetail=await (await request.get(`/api/questions/${notice}/classification?${scope}`)).json();expect(noticeDetail.structureIssues.map(issue=>issue.severity)).toEqual(['notice']);
});
