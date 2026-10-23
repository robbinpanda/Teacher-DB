import { test,expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({extraHTTPHeaders:{'oai-authenticated-user-id':'studio-test'}});
const scope='subject='+encodeURIComponent('数学')+'&stage=high';
const period='math.high.trigonometry.period';
async function prepare(context){
 await context.addCookies([{name:'teacher-db-scope',value:encodeURIComponent(JSON.stringify({subject:'数学',stage:'high'})),url:'http://127.0.0.1:3189'}]);
 const db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3'));
 const id=crypto.randomUUID(),doc=crypto.randomUUID(),time=new Date().toISOString();
 db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES(?,'studio-test','周期选题资料','application/pdf','complete','数学','高三',?,?)").run(doc,time,time);
 db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,?,'1','fill','求函数 $y=sin(2x)$ 的最小正周期。','$\\pi$','由周期公式得 $T=2\\pi/2=\\pi$。','approved',1,'{}',?,?)").run(id,doc,time,time);db.close();return {id,doc};
}

test('批量标注刷新后可核对确认，方法能力来源筛选与跨页选题有效',async({page,context,request})=>{
 test.setTimeout(90000);
 const {doc}=await prepare(context),db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3')),now=new Date().toISOString();
 db.prepare("UPDATE documents SET name='批量标注分页资料' WHERE id=?").run(doc);
 const insert=db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,?,?,'fill',?,'π','周期公式计算。','approved',1,'{}',?,?)");
 for(let i=2;i<=52;i++)insert.run(crypto.randomUUID(),doc,String(i),`第 ${i} 道：求函数 y=sin(2x) 的最小正周期。`,now,now);db.close();
 let calls=0;
 const classification={knowledge:[{id:period,evidence:'题目明确要求计算正弦函数的最小正周期。'}],methods:['公式变形'],competencies:['数学运算'],difficulty:2,difficultyReason:'识别角系数后直接代入最小正周期公式。',prerequisites:[],confidence:.9};
 const model=createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(classification)}}]}));});});
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 try{
  expect((await request.post('/api/model-profiles',{data:{displayName:`批量测试-${crypto.randomUUID()}`,provider:'openai-compatible',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,model:'mock',apiKey:'test-only',select:true}})).status()).toBe(201);
  await page.goto('/studio');await page.getByRole('button',{name:'精准选题与标注'}).click();
  await page.getByRole('combobox',{name:'来源资料',exact:true}).selectOption(doc);await page.getByRole('button',{name:'检索',exact:true}).click();
  await expect(page.locator('.studio-results article')).toHaveCount(50);
  const selected=[];for(let i=0;i<3;i++){const checkbox=page.locator('.studio-results input[type=checkbox]').nth(i);selected.push((await checkbox.getAttribute('aria-label')).replace('选择题目 ',''));await checkbox.check();}
  await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('.studio-results article')).toHaveCount(2);
  await expect(page.locator('.studio-selection')).toContainText('已选 3 题');
  await page.getByRole('button',{name:'批量分析所选 3 题'}).click();
  await expect(page.locator('.studio-batch-item')).toHaveCount(3);
  await expect(page.locator('.studio-batch-item').getByText('已生成建议',{exact:true})).toHaveCount(3,{timeout:45000});expect(calls).toBe(3);
  await page.reload();await page.getByRole('button',{name:'精准选题与标注'}).click();await page.getByText('最近的批量标注',{exact:true}).click();
  await page.getByRole('button',{name:/3\/3 题完成/}).click();
  for(const id of selected)await page.getByRole('checkbox',{name:`确认标签 ${id}`,exact:true}).check();
  await page.getByRole('button',{name:'确认已核对的 3 题标签'}).click();await expect(page.locator('.studio-batch-item').getByText('教师已确认',{exact:true})).toHaveCount(3);
  await page.getByRole('button',{name:'收起批量核对'}).click();
  await page.getByRole('combobox',{name:'来源资料',exact:true}).selectOption(doc);
  await page.getByRole('combobox',{name:'解题方法',exact:true}).selectOption('公式变形');
  await page.getByRole('combobox',{name:'考查能力',exact:true}).selectOption('数学运算');
  await page.getByRole('combobox',{name:'题型',exact:true}).selectOption('fill');await page.getByLabel('仅教师确认标签').check();
  await page.getByRole('button',{name:'检索',exact:true}).click();await expect(page.locator('.studio-results article')).toHaveCount(3);
  await page.getByRole('combobox',{name:'考查能力',exact:true}).selectOption('数学建模');await page.getByRole('button',{name:'检索',exact:true}).click();await expect(page.locator('.studio-results article')).toHaveCount(0);
  await page.getByRole('combobox',{name:'考查能力',exact:true}).selectOption('数学运算');await page.getByRole('button',{name:'检索',exact:true}).click();
  await page.setViewportSize({width:760,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'tmp/teacher-pilot/batch-browser.png',fullPage:true});
 }finally{await new Promise(resolve=>model.close(resolve));}
});

test('整卷变式可选择原卷、逐题对照采用、刷新恢复并导出保留题号分值的 PDF',async({page,context,request})=>{
 test.setTimeout(150000);
 const {id,doc}=await prepare(context), second=crypto.randomUUID();
 const db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3')),now=new Date().toISOString();
 db.prepare("UPDATE documents SET name='整卷变式浏览器原卷' WHERE id=?").run(doc);
 db.prepare("UPDATE questions SET number='3',score=5 WHERE id=?").run(id);
 db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,score,created_at,updated_at) VALUES(?,?,'7','fill','求函数 $y=cos(3x)$ 的最小正周期。','三分之二π','使用周期公式。','approved',1,'{}',8,?,?)").run(second,doc,now,now);db.close();
 let calls=0;
 const model=createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{calls++;const text=JSON.stringify(JSON.parse(raw).messages);let output;
  const offset=text.includes('cos(3x)')?10:0;
  const variations=[4+offset,5+offset].map(value=>({stem:`求函数 $y=\\sin(${value}x)$ 的最小正周期。`,type:'fill',options:[],answer:`$2\\pi/${value}$`,analysis:`角系数为 ${value}，振幅及角系数非零，由周期公式得结果。`,tags:[],changeNote:'改变角系数，保留周期公式的考查目标',diagram:null}));
  if(text.includes('逐题核查可解性'))output={checks:[{index:1,score:92,solvable:true,answerCorrect:true,objectiveAligned:true,difficultyAligned:true,explanation:'代入复算结果一致，目标难度保持。'}]};
  else if(text.includes('规划 2 道变式'))output={objective:'计算最小正周期',prerequisites:'周期公式',difficultyRationale:'直接代入公式',misconception:'忽略绝对值',changes:['改变角系数','改变函数']};
  else if(text.includes('独立审校与修订 Agent'))output={reviews:[{index:1,verdict:'pass',score:92,issues:[],finalVariation:variations[0]}]};
  else output={variations};res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
 });});
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 try{
  expect((await request.post('/api/model-profiles',{data:{displayName:`整卷测试-${crypto.randomUUID()}`,provider:'openai-compatible',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,model:'mock',apiKey:'test-only',select:true}})).status()).toBe(201);
  await page.goto('/studio');await page.getByRole('combobox',{name:'作品类型',exact:true}).selectOption('variation');
  await page.getByRole('combobox',{name:'选择原卷',exact:true}).selectOption(`uploaded:${doc}`);
  await page.getByLabel('教学要求',{exact:true}).fill('保持原题知识目标和题型，改变参数，难度与原卷一致。');
  await page.getByRole('button',{name:'读取原卷，确认逐题对应'}).click();
  await expect(page.getByRole('heading',{name:'整卷变式浏览器原卷 · 整卷变式'})).toBeVisible();
  await expect(page.locator('.studio-variations')).toContainText('2 题 · 13 分');
  await page.getByRole('button',{name:'确认原卷，逐题生成'}).click();
  await expect(page.locator('.studio-variations summary').filter({hasText:'待核对采用'})).toHaveCount(2,{timeout:45000});expect(calls).toBe(8);
  await page.reload();await page.getByRole('button',{name:/整卷变式浏览器原卷 · 变式卷/}).click();
  for(const number of ['3','7']){
   const detail=page.locator('.studio-variations details.studio-chapter').filter({has:page.locator('summary').filter({hasText:`第 ${number} 题`})});
   await detail.locator(':scope > summary').click();await expect(detail.locator('.studio-variation-comparison')).toBeVisible();
   await detail.getByRole('button',{name:'核对完成，采用此题'}).click();
   await expect(detail.locator(':scope > summary')).toContainText('已采用');
  }
  await page.screenshot({path:'tmp/teacher-pilot/whole-variation-browser.png',fullPage:true});
  await page.getByRole('button',{name:'进入组卷器与导出变式卷'}).click();await expect(page).toHaveURL(/\/papers\/[a-f0-9-]+$/);
  const paperId=page.url().split('/').pop();
  await expect(page.locator('.printable-paper .paper-question-line > b')).toHaveText(['3.','7.']);
  // Saving in the ordinary editor must retain the original-number mapping.
  await page.getByRole('button',{name:'保存试卷',exact:true}).click();
  await expect(page.getByRole('button',{name:'下载试卷',exact:true})).toBeEnabled();
  await page.reload();await expect(page.locator('.printable-paper .paper-question-line > b')).toHaveText(['3.','7.']);
  const response=await request.get(`/api/papers/${paperId}/pdf`,{timeout:120000});expect(response.status()).toBe(200);
  const bytes=await response.body();await writeFile('tmp/teacher-pilot/whole-variation-student.pdf',bytes);
  const task=getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise;let full='';
  for(let p=1;p<=pdf.numPages;p++){const text=(await(await pdf.getPage(p)).getTextContent()).items.map(i=>i.str).join('');expect(text.length).toBeGreaterThan(4);full+=text;}
  expect(full).toContain('3.');expect(full).toContain('7.');expect(full.replace(/\s/g,'')).toContain('8分');expect(full).not.toContain('振幅及角系数非零');await task.destroy();
 }finally{await new Promise(resolve=>model.close(resolve));}
});
test('教师可核对标签、按考点难度检索，再将选题带入原有组卷器',async({page,context,request})=>{
 const {id}=await prepare(context);await page.goto('/studio');
 await page.getByRole('button',{name:'精准选题与标注'}).click();
 await page.locator('.studio-results article').filter({has:page.getByRole('checkbox',{name:`选择题目 ${id}`,exact:true})}).getByRole('button',{name:'查看题目与标签'}).click();
 await page.getByRole('button',{name:'手动标注',exact:true}).click();await page.getByRole('button',{name:'增加考点'}).click();
 await page.getByLabel('考点 1',{exact:true}).selectOption(period);
 await page.getByLabel('考点依据 1',{exact:true}).fill('题干直接要求求最小正周期。');
 await page.getByLabel('难度依据',{exact:true}).fill('只需识别角系数并代入周期公式即可。');
 await page.getByRole('button',{name:'保存并确认标签'}).click();await expect(page.getByRole('status')).toContainText('标签已确认');
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByLabel('关键词',{exact:true}).fill('最小正周期');await page.getByLabel('仅教师确认标签').check();
 await page.getByRole('button',{name:'检索',exact:true}).click();
 await expect(page.locator('.studio-results article').first()).toContainText('已确认');
 await page.getByRole('checkbox',{name:`选择题目 ${id}`}).check();
 await expect(page.getByRole('link',{name:'进入组卷'})).toHaveAttribute('href',`/papers/new?ids=${id}`);
 const other=await request.get(`/api/questions/${id}/classification?${scope}`,{headers:{'oai-authenticated-user-id':'other'}});expect(other.status()).toBe(404);
 await page.setViewportSize({width:1366,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'tmp/teacher-pilot/search-browser.png',fullPage:true});
});

test('未标注三角函数候选可由选项和任务线索发现，但不能冒充确认标签或难度',async({page,context,request})=>{
 const {id,doc}=await prepare(context);
 const db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3'));
 db.prepare("UPDATE questions SET stem='下列函数的最大值为一的是',options_json=?,analysis='比较各函数的取值。' WHERE id=?").run(JSON.stringify([{key:'A',content:'$y=\\sin x$'},{key:'B',content:'$y=x$'}]),id);db.close();
 await page.goto('/studio');await page.getByRole('button',{name:'精准选题与标注'}).click();
 await page.getByRole('combobox',{name:'来源资料',exact:true}).selectOption(doc);
 await page.getByRole('combobox',{name:'知识点',exact:true}).selectOption('math.high.trigonometry.extrema');
 await page.getByRole('button',{name:'检索',exact:true}).click();
 await expect(page.locator('.studio-results article')).toHaveCount(1);
 await expect(page.locator('.studio-results article')).toContainText('题干或选项线索');
 await expect(page.locator('.studio-results article')).toContainText('待标注');
 const results=await (await request.post(`/api/knowledge?${scope}`,{data:{knowledgeIds:['math.high.trigonometry.extrema'],documentIds:[doc]}})).json();
 expect(results.hits[0].id).toBe(id);expect(results.hits[0].matchedKnowledgeIds).toEqual([]);expect(results.hits[0].classification).toBeNull();
 expect(results.difficultyCounts.every(level=>level.classified===0&&level.confirmed===0)).toBe(true);
 await page.screenshot({path:'tmp/teacher-pilot/discovery-browser.png',fullPage:true});
 await page.getByLabel('仅教师确认标签').check();await page.getByRole('button',{name:'检索',exact:true}).click();
 await expect(page.locator('.studio-results article')).toHaveCount(0);
 await page.getByLabel('仅教师确认标签').uncheck();await page.getByRole('combobox',{name:'难度',exact:true}).selectOption('2');
 await page.getByRole('button',{name:'检索',exact:true}).click();await expect(page.locator('.studio-results article')).toHaveCount(0);
});

test('自然语言规划通过后台模型调用持久化，可刷新恢复、修改题量、检查缺口并阻止旧版本覆盖',async({page,context,request})=>{
 test.setTimeout(60000);const {doc}=await prepare(context);
 const seed=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3'));
 seed.prepare("UPDATE documents SET name='规划缺口专用资料' WHERE id=?").run(doc);seed.close();
 const slot={role:'example',knowledgeIds:[period],difficulty:2,type:'fill',count:2,score:0,purpose:'直接使用周期公式'};
 const plan={title:'三角函数周期复习讲义',audience:'高三基础班',approach:'先理解周期定义，再逐步迁移到复合角函数',estimatedMinutes:45,assumptions:['学生已掌握弧度制'],chapters:[{id:'period',title:'周期概念与计算',objectives:['理解周期并计算最小正周期'],knowledgeIds:[period],prerequisites:[],teachingNotes:'借助单位圆说明周期，再归纳计算步骤。',slots:[slot,{...slot,role:'practice',count:4}]}]};
 let calls=0;
 const requirements={numeric:[{metric:'questions',scope:'work',roles:['example'],operator:'eq',value:2,evidence:'2 道例题'},{metric:'questions',scope:'work',roles:['practice'],operator:'eq',value:4,evidence:'4 道练习'}],knowledge:[],questions:[],assumptions:[]};
 const model=createServer((req,res)=>{let text='';req.on('data',part=>{text+=part;});req.on('end',()=>{calls++;const input=JSON.parse(text);expect(JSON.stringify(input)).toContain('教学');res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(input.messages[0].content.includes('教学需求核对员')?requirements:plan)}}],usage:{prompt_tokens:10,completion_tokens:20}}));});});
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 try{
  const configured=await request.post('/api/model-profiles',{data:{displayName:`规划测试-${crypto.randomUUID()}`,provider:'openai-compatible',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,model:'mock',apiKey:'test-only',select:true}});expect(configured.status()).toBe(201);
  await page.goto('/studio');await page.getByLabel('教学要求',{exact:true}).fill('给高三学生制作三角函数周期讲义，2 道例题、4 道练习。');
  await page.getByText('选择资料范围（整个当前题库）',{exact:true}).click();await page.getByRole('checkbox',{name:'规划缺口专用资料 · 1 题',exact:true}).check();
  await expect(page.getByRole('button',{name:'生成教学大纲'})).toBeEnabled();await page.getByRole('button',{name:'生成教学大纲'}).click();
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue(plan.title,{timeout:30000});expect(calls).toBe(2);
  const list=await (await request.get(`/api/authoring?${scope}`)).json();const saved=list.projects.find(p=>p.title===plan.title);expect(saved).toBeTruthy();
  const before=await (await request.get(`/api/authoring/${saved.id}?${scope}`)).json();
  await page.reload();await page.getByRole('button',{name:new RegExp(plan.title)}).click();await expect(page.getByLabel('标题',{exact:true})).toHaveValue(plan.title);
  await page.getByRole('button',{name:'检查题库覆盖'}).click();await expect(page.locator('.studio-gap').first()).toContainText('还需核对或补充');
  await page.getByLabel('第 1 章第 2 组题量').fill('6');await expect(page.getByRole('button',{name:'检查题库覆盖'})).toBeDisabled();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'教学范围 高中 · 数学'}).click();await page.getByRole('button',{name:'初中',exact:true}).click();
  await expect(page.getByLabel('第 1 章第 2 组题量')).toHaveValue('6');await expect(page.getByRole('button',{name:'教学范围 高中 · 数学'})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'保存大纲',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'未满足教师要求'})).toBeVisible();
  await page.getByText('修改第 2 项要求',{exact:true}).click();await page.getByLabel('要求 2 数值',{exact:true}).fill('6');
  await page.getByRole('button',{name:'保存大纲',exact:true}).click();await expect(page.getByText('大纲已保存',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'教学要求核对'})).toContainText('已包含教师调整');
  await expect(page.getByRole('button',{name:'移除第 1 章',exact:true})).toBeDisabled();
  await page.getByLabel('第 1 章第 2 组题量').fill('7');await page.getByRole('button',{name:'取消修改',exact:true}).click();
  await expect(page.getByLabel('第 1 章第 2 组题量')).toHaveValue('6');
  const conflict=await request.patch(`/api/authoring/${saved.id}?${scope}`,{data:{revision:before.project.revision,plan}});expect(conflict.status()).toBe(409);
  const foreign=await request.get(`/api/authoring/${saved.id}?${scope}`,{headers:{'oai-authenticated-user-id':'other'}});expect(foreign.status()).toBe(404);
  await page.screenshot({path:'tmp/teacher-pilot/plan-browser.png',fullPage:true});
 }finally{await new Promise(resolve=>model.close(resolve));}
});

test('逐章编写、教师修改采用和学生教师两版实际PDF完整可用',async({page,context,request})=>{
 test.setTimeout(150000);
 const first=await prepare(context),second=await prepare(context);
 const db=new Database(path.join(process.env.JIANTI_E2E_DATA_DIR,'teacher-question-bank.sqlite3'));
 db.prepare("UPDATE questions SET type='answer',stem='求函数 $y=sin(3x)$ 的最小正周期，并说明计算依据。',answer='练习专用答案标记',analysis='用角系数的绝对值计算，得到最小正周期为三分之二π。' WHERE id=?").run(second.id);db.close();
 const slot={role:'example',knowledgeIds:[period],difficulty:2,type:'fill',count:1,score:0,purpose:'理解周期公式并正确代入'};
 const plan={title:'完整周期讲义浏览器验证',audience:'高三基础班',approach:'概念理解、例题示范、独立练习逐步提高。',estimatedMinutes:45,assumptions:[],chapters:[{id:'period',title:'周期概念与计算',objectives:['准确计算最小正周期并说明依据'],knowledgeIds:[period],prerequisites:[],teachingNotes:'说明角系数非零条件以及绝对值的意义。',slots:[slot,{...slot,role:'practice',type:'answer'}]}]};
 const reviewModels=[];const reviewerName=`独立审校-${crypto.randomUUID()}`;
 const lesson={id:period,title:'最小正周期及其计算',explanation:'周期函数的函数值按固定间隔重复，最小正周期是所有正周期中的最小值。研究周期时必须明确自变量的变化范围，并确认恒等关系对定义域内所有自变量成立。正弦函数的角系数会改变变化速度，因此需要使用角系数的绝对值计算周期，不能忽略非零条件。',formulas:[{latex:'T=2\\pi/|\\omega|',conditions:'振幅和角系数均不为零。'}],method:'先识别函数类型和角系数，再判断非零条件，将角系数的绝对值代入周期公式并检查结果。',misconceptions:[{mistake:'直接使用负的角系数。',correction:'周期必须取正值，所以要使用角系数的绝对值。'}]};
 const model=createServer((req,res)=>{let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
  const input=JSON.parse(raw),system=input.messages.find(m=>m.role==='system').content,user=input.messages.find(m=>m.role==='user').content;
  const data=JSON.parse(typeof user==='string'?user:user.find(p=>p.type==='text').text);let output;
  if(system.includes('输出 JSON {items:'))output={items:[{slotIndex:0,questionId:first.id,selectionReason:'通过识别角系数和代入公式示范基本方法。'},{slotIndex:1,questionId:second.id,selectionReason:'更换角系数后让学生独立说明推导依据。'}],gaps:[]};
  else if(system.includes('独立审校教师')){reviewModels.push(input.model);output={checks:(data.checks??[]).map(c=>({id:c.id,passed:true,evidenceRefs:['introduction:0'],reason:"已逐项核对该学科要求和对应内容。"})),knowledge:data.content.knowledge.map(k=>({id:k.id,correct:true,complete:true,reason:'公式使用条件明确，概念和方法完整。'})),questions:data.content.items.map(q=>({id:q.questionId,aligned:true,difficultyAppropriate:true,explanationCorrect:true,reason:'逐题核对条件、难度和推导，符合本章要求。'}))};}
  else if(system.includes('校本教辅编辑'))output={...data.selection,knowledge:[lesson],introduction:'本章从周期定义出发，通过例题示范后安排独立练习。',items:data.selection.items.map(q=>({...q,teachingExplanation:'首先确认函数为正弦函数，振幅及角系数均不为零，再识别角系数。利用最小正周期等于二π除以角系数绝对值的公式，代入得到结果。最后将周期平移代入函数，验证前后函数值相同，并注意周期必须取正值。'})),conclusion:'本章掌握周期公式的条件，能够识别角系数并完成计算。'};
  else if(system.includes('教学需求核对员'))output={numeric:[],knowledge:[],questions:[],assumptions:[]};
  else output=plan;
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
 });});
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 try{
  const configured=await (await request.post('/api/model-profiles',{data:{displayName:`完整讲义-${crypto.randomUUID()}`,provider:'openai-compatible',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,model:'mock',apiKey:'test-only',select:true}})).json();
  const configuredReviewer=await (await request.post('/api/model-profiles',{data:{displayName:reviewerName,provider:'openai-compatible',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,model:'review-mock',apiKey:'test-review-only',select:false}})).json();
  const created=await (await request.post(`/api/authoring?${scope}`,{data:{kind:'handout',instruction:'生成一章三角函数周期讲义，含知识讲解、一例一练。',documentIds:[first.doc,second.doc],profileId:configured.profile.id,reviewerProfileId:configuredReviewer.profile.id}})).json();
  const id=created.project.id;
  await expect.poll(async()=> (await (await request.get(`/api/authoring/${id}?${scope}`)).json()).project.status,{timeout:30000}).toBe('planned');
  await page.goto('/studio');await page.getByRole('button',{name:new RegExp(plan.title)}).click();
  await page.getByRole('button',{name:'确认大纲，逐章生成'}).click();
  await expect(page.getByRole('button',{name:'已核对，采用本章'})).toBeEnabled({timeout:45000});
  await expect(page.locator('.studio-selected-question')).toHaveCount(2);
  expect(reviewModels).toContain('review-mock');
  await expect(page.locator('.studio-review-model')).toContainText(reviewerName);
  await page.locator('.studio-review-checks > summary').click();
  await page.getByText('查看原文依据',{exact:true}).first().click();
  await expect(page.locator('.studio-review-checks blockquote').first()).toContainText('本章从周期定义出发，通过例题示范后安排独立练习。');
  const cited=(await (await request.get(`/api/authoring/${id}?${scope}`)).json()).project.chapters[0].content.review.checks[0];
  expect(cited.evidenceRefs).toEqual(['introduction:0']);
  await page.locator('.studio-review-checks').screenshot({path:'tmp/teacher-pilot/evidence-review-browser.png'});
  await page.locator('.studio-review-checks > summary').click();
  await page.getByText('本作品模型设置',{exact:true}).click();
  const reviewerSelect=page.getByRole('combobox',{name:'本作品审校模型',exact:true});
  await expect(reviewerSelect).toBeEnabled();
  await Promise.all([page.waitForResponse(response=>response.url().includes(`/api/authoring/${id}`)&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='models',{timeout:10000}),reviewerSelect.selectOption({value:''},{timeout:10000})]);
  await expect(reviewerSelect).toHaveValue('');
  await expect(page.locator('.studio-review-model')).toContainText(reviewerName);
  await page.locator('.studio-model-settings').screenshot({path:'tmp/teacher-pilot/reviewer-settings-browser.png'});
  await page.getByRole('button',{name:'重新审校',exact:true}).click();
  await expect(page.locator('.studio-review-model')).toContainText(configured.profile.displayName,{timeout:45000});
  await expect(page.getByRole('button',{name:'已核对，采用本章'})).toBeEnabled();
  expect(reviewModels).toContain('mock');
  const switched=(await (await request.get(`/api/authoring/${id}?${scope}`)).json()).project;
  expect(switched.request.reviewerProfileId).toBeUndefined();
  expect(switched.chapters[0].content.review.modelProfileId).toBe(configured.profile.id);

  const early=await request.get(`/api/authoring/${id}/pdf?${scope}`);expect(early.status()).toBe(409);
  await page.getByRole('button',{name:'修改正文与选题'}).click();
  await page.getByRole('textbox',{name:'本章小结',exact:true}).fill('教师补充说明：检查角系数和振幅均非零，再求最小正周期。');
  await page.getByRole('button',{name:'保存本章修改'}).click();
  await expect(page.getByText('教师修改了本章内容，请重新审校或核对后采用。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'已核对，采用本章'})).toBeDisabled();
  await page.getByLabel(/人工核对说明/).fill('已经逐项检查公式条件、例题和练习的推导，确认正确。');
  await page.getByRole('button',{name:'已核对，采用本章'}).click();
  await expect(page.getByRole('link',{name:'学生版 PDF',exact:true})).toBeVisible();
  await page.locator('.studio-work-coverage summary').click();
  await expect(page.locator('.studio-work-coverage')).toContainText('1/1 个考点完成核对');
  await expect(page.locator('.studio-work-coverage')).toContainText('教师已采用 2/2 道题');
  await page.locator('.studio-work-coverage').screenshot({path:'tmp/teacher-pilot/work-coverage-browser.png'});
  await page.getByRole('link',{name:'预览整份作品'}).click();
  await expect(page.locator('.authoring-document')).toHaveAttribute('data-pagination-ready','true');
  await expect(page.locator('.authoring-document')).toContainText('教师补充说明');
  await expect(page.locator('.authoring-document')).not.toContainText('练习专用答案标记');
  expect(await page.locator('.authoring-writing-space').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(499);
  await mkdir('tmp/teacher-pilot',{recursive:true});await page.screenshot({path:'tmp/teacher-pilot/chapter-preview.png',fullPage:true});
  for(const answers of [false,true]){
   const response=await request.get(`/api/authoring/${id}/pdf?${scope}&answers=${answers?'1':'0'}`,{timeout:120000});expect(response.status()).toBe(200);
   const bytes=await response.body();await writeFile(`tmp/teacher-pilot/handout-${answers?'teacher':'student'}.pdf`,bytes);
   const task=getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise;let full='';
   for(let p=1;p<=pdf.numPages;p++){const text=(await (await pdf.getPage(p)).getTextContent()).items.map(i=>i.str).join('');expect(text.length).toBeGreaterThan(4);full+=text;}
   expect(full).toContain('教师补充说明');expect(full.includes('练习专用答案标记')).toBe(answers);expect(full).not.toContain('返回备课工作台');await task.destroy();
  }
  expect((await request.get(`/api/authoring/${id}/pdf?${scope}`,{headers:{'oai-authenticated-user-id':'other'}})).status()).toBe(404);
  await page.goto('/studio');await page.getByRole('button',{name:new RegExp(plan.title)}).click();
  const beforeReplan=(await (await request.get(`/api/authoring/${id}?${scope}`)).json()).project;
  await page.getByRole('button',{name:'调整本章计划',exact:true}).click();
  await page.getByRole('textbox',{name:'本章标题',exact:true}).fill('周期概念与计算：补充易错点');
  await page.getByLabel('本章第 1 组分值',{exact:true}).fill('3');
  await page.getByRole('textbox',{name:'本章讲解与衔接要求',exact:true}).fill('加强角系数和振幅非零条件的讲解，并说明最小性。');
  await page.locator('.studio-replacement').screenshot({path:'tmp/teacher-pilot/chapter-plan-browser.png'});
  await page.getByRole('button',{name:'保存计划并重做本章',exact:true}).click();
  await expect(page.getByRole('link',{name:'学生版 PDF',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'1. 周期概念与计算：补充易错点',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'已核对，采用本章'})).toBeEnabled({timeout:45000});
  await expect(page.locator('.studio-work-coverage')).toContainText('0/1 个考点完成核对');
  const afterReplan=(await (await request.get(`/api/authoring/${id}?${scope}`)).json()).project;
  expect(afterReplan.plan.chapters[0].slots[0].score).toBe(3);
  const oldVersion=afterReplan.chapters[0].history.find(version=>version.revision===beforeReplan.chapters[0].revision);
  expect(oldVersion.hasPlan).toBe(true);expect(oldVersion.hasContent).toBe(true);
  const historyUrl=`/api/authoring/${id}/chapters/${afterReplan.chapters[0].id}?${scope}&version=${oldVersion.id}`;
  expect((await request.get(historyUrl,{headers:{'oai-authenticated-user-id':'other'}})).status()).toBe(404);
  const snapshot=(await (await request.get(historyUrl)).json()).version;
  expect(snapshot.plan.slots[0].score).toBe(0);expect(snapshot.content.conclusion).toContain('教师补充说明');
  await page.locator('.studio-history summary').click();
  await page.getByRole('button',{name:`查看版本 ${oldVersion.revision}`,exact:true}).click();
  await expect(page.getByRole('region',{name:`历史版本 ${oldVersion.revision}`,exact:true})).toContainText('当时的章节计划');
  await page.locator('.studio-historical-content').screenshot({path:'tmp/teacher-pilot/history-preview-browser.png'});
  await page.getByRole('button',{name:'恢复计划与正文',exact:true}).click();
  await expect(page.getByRole('heading',{name:'1. 周期概念与计算',exact:true})).toBeVisible();
  await expect(page.getByText('已恢复历史计划与正文，请重新审校或核对后采用。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'已核对，采用本章'})).toBeDisabled();
  const restored=(await (await request.get(`/api/authoring/${id}?${scope}`)).json()).project;
  expect(restored.plan.chapters[0].slots[0].score).toBe(0);
  expect(restored.chapters[0].content.teacherApproval).toBeUndefined();
  expect(restored.chapters[0].history.some(version=>version.revision===afterReplan.chapters[0].revision)).toBe(true);
  await page.getByLabel(/人工核对说明/).fill('已核对恢复的章节计划、分值和原题解析，确认内容正确。');
  await page.getByRole('button',{name:'已核对，采用本章'}).click();await expect(page.getByRole('link',{name:'学生版 PDF',exact:true})).toBeVisible();
 }finally{await new Promise(resolve=>model.close(resolve));}
});
