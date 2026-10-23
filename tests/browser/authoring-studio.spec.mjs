import { test,expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { createServer } from 'node:http';

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
test('教师可核对标签、按考点难度检索，再将选题带入原有组卷器',async({page,context,request})=>{
 const {id}=await prepare(context);await page.goto('/studio');
 await page.getByRole('button',{name:'精准选题与标注'}).click();
 await page.getByRole('button',{name:'查看题目与标签'}).first().click();
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

test('自然语言规划通过后台模型调用持久化，可刷新恢复、修改题量、检查缺口并阻止旧版本覆盖',async({page,context,request})=>{
 test.setTimeout(60000);await prepare(context);
 const slot={role:'example',knowledgeIds:[period],difficulty:2,type:'fill',count:2,score:0,purpose:'直接使用周期公式'};
 const plan={title:'三角函数周期复习讲义',audience:'高三基础班',approach:'先理解周期定义，再逐步迁移到复合角函数',estimatedMinutes:45,assumptions:['学生已掌握弧度制'],chapters:[{id:'period',title:'周期概念与计算',objectives:['理解周期并计算最小正周期'],knowledgeIds:[period],prerequisites:[],teachingNotes:'借助单位圆说明周期，再归纳计算步骤。',slots:[slot,{...slot,role:'practice',count:4}]}]};
 let calls=0;
 const model=createServer((req,res)=>{let text='';req.on('data',part=>{text+=part;});req.on('end',()=>{calls++;const input=JSON.parse(text);expect(JSON.stringify(input)).toContain('教学');res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}],usage:{prompt_tokens:10,completion_tokens:20}}));});});
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 try{
  const configured=await request.post('/api/model-profiles',{data:{displayName:`规划测试-${crypto.randomUUID()}`,provider:'openai-compatible',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,model:'mock',apiKey:'test-only',select:true}});expect(configured.status()).toBe(201);
  await page.goto('/studio');await page.getByLabel('教学要求',{exact:true}).fill('给高三学生制作三角函数周期讲义，2 道例题、4 道练习。');
  await expect(page.getByRole('button',{name:'生成教学大纲'})).toBeEnabled();await page.getByRole('button',{name:'生成教学大纲'}).click();
  await expect(page.getByLabel('标题',{exact:true})).toHaveValue(plan.title,{timeout:30000});expect(calls).toBe(1);
  const list=await (await request.get(`/api/authoring?${scope}`)).json();const saved=list.projects.find(p=>p.title===plan.title);expect(saved).toBeTruthy();
  const before=await (await request.get(`/api/authoring/${saved.id}?${scope}`)).json();
  await page.reload();await page.getByRole('button',{name:new RegExp(plan.title)}).click();await expect(page.getByLabel('标题',{exact:true})).toHaveValue(plan.title);
  await page.getByRole('button',{name:'检查题库覆盖'}).click();await expect(page.locator('.studio-gap').first()).toContainText('还需核对或补充');
  await page.getByLabel('第 1 章第 2 组题量').fill('6');await expect(page.getByRole('button',{name:'检查题库覆盖'})).toBeDisabled();
  await page.getByRole('button',{name:'保存大纲',exact:true}).click();await expect(page.getByText('大纲已保存',{exact:true})).toBeVisible();
  const conflict=await request.patch(`/api/authoring/${saved.id}?${scope}`,{data:{revision:before.project.revision,plan}});expect(conflict.status()).toBe(409);
  const foreign=await request.get(`/api/authoring/${saved.id}?${scope}`,{headers:{'oai-authenticated-user-id':'other'}});expect(foreign.status()).toBe(404);
  await page.screenshot({path:'tmp/teacher-pilot/plan-browser.png',fullPage:true});
 }finally{await new Promise(resolve=>model.close(resolve));}
});
