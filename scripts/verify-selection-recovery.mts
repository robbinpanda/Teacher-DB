// This fixture intercepts every model request locally. It never calls a remote API.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDatabase } from '../db/bootstrap.ts';
import { getSqlite } from '../db/index.ts';
import { encryptSecret } from '../lib/secret-box.ts';
import { readAuthoringProject } from '../server/services/authoring.ts';
import { controlAuthoringProject,kickAuthoringChapters,retryAuthoringChapter } from '../server/services/authoring-chapters.ts';

await ensureDatabase();
const db=getSqlite(),mode=process.argv[2],scope={subject:'数学',stage:'high' as const},now=new Date().toISOString();
const read=()=>readAuthoringProject('teacher',scope,'project')!;
if(!db.prepare("SELECT 1 FROM authoring_projects WHERE id='project'").get()){
  const key=await encryptSecret('fixture-only-key');
  db.prepare("INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at) VALUES('model','teacher','Fixture','openai-compatible','https://fixture.invalid/v1','fixture',?,?,'test',?,?)").run(key.ciphertext,key.iv,now,now);
  db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('doc','teacher','周期候选','application/pdf','complete','数学','高三',?,?)").run(now,now);
  for(let i=0;i<132;i++)db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES(?,'doc',?,'fill',?,'参考答案','根据周期公式计算','approved',1,'{}',?,?)").run(`q${String(i).padStart(3,'0')}`,String(i),`求函数 sin(${i+1}x) 的最小正周期。`,now,now);
  const period='math.high.trigonometry.period',slot={role:'example',knowledgeIds:[period],difficulty:2,type:'fill',count:1,score:5,purpose:'比较周期计算方法'};
  const chapter={id:'period',title:'周期概念与计算',knowledgeIds:[period],prerequisites:[],objectives:['掌握最小正周期的计算'],teachingNotes:'由概念过渡到例题与练习',slots:[slot,{...slot,role:'practice'}]};
  const plan={title:'恢复验证',audience:'高三学生',approach:'由概念理解过渡到计算练习',estimatedMinutes:45,assumptions:[],chapters:[chapter]};
  const request={kind:'handout',instruction:'生成由例题到练习的周期专题讲义',documentIds:['doc'],requiredKnowledgeIds:[],profileId:'model',variationDifficulty:'similar'};
  db.prepare("INSERT INTO authoring_projects(id,owner_id,subject,stage,kind,title,request_json,plan_json,status,created_at,updated_at) VALUES('project','teacher','数学','high','handout','恢复验证',?,?,'generating',?,?)").run(JSON.stringify(request),JSON.stringify(plan),now,now);
  db.prepare("INSERT INTO authoring_chapters(id,project_id,position,plan_json,status,updated_at) VALUES('chapter','project',0,?,'pending',?)").run(JSON.stringify(chapter),now);
}
const originalFetch=globalThis.fetch;let requests=0,selectionRequests=0,firstRound:number|undefined;
globalThis.fetch=async(_url,init)=>{
  requests++;
  const body=JSON.parse(String(init?.body)),messages=body.messages;
  const system=messages.find((message:{role:string})=>message.role==='system').content;
  const user=messages.find((message:{role:string})=>message.role==='user').content;
  const input=JSON.parse(typeof user==='string'?user:user.find((part:{type:string})=>part.type==='text').text);
  if(!system.includes('输出 JSON {items:'))throw new Error('fixture-writer-stop');
  selectionRequests++;firstRound??=input.round;
  appendFileSync(path.join(process.env.JIANTI_DATA_DIR!,'selection-calls.jsonl'),JSON.stringify({mode,round:input.round,model:body.model})+'\n');
  if(mode==='crash'&&input.round===2)process.exit(73);
  if(mode==='pause-compat'||mode==='pause-repair'){
    await controlAuthoringProject('teacher',scope,'project',read().revision,'pause');
    return mode==='pause-compat'?new Response('unsupported response_format',{status:400}):Response.json({choices:[{message:{content:JSON.stringify({items:[],gaps:[]})}}]});
  }
  const chosen=new Set<string>(),items=input.pools.flatMap((pool:string[],slotIndex:number)=>{
    const id=pool.find(id=>['q130','q131'].includes(id)&&!chosen.has(id));if(!id)return [];chosen.add(id);return [{slotIndex,questionId:id,selectionReason:'这道题符合本组指定的教学目标与难度要求。'}];
  });
  const gaps=input.chapter.slots.flatMap((_:unknown,slotIndex:number)=>items.some((item:{slotIndex:number})=>item.slotIndex===slotIndex)?[]:[{slotIndex,reason:'本批尚无合适题目，请继续比较后面的候选。'}]);
  if(mode==='resume'&&!gaps.length||mode.startsWith('invalidate'))await controlAuthoringProject('teacher',scope,'project',read().revision,'pause');
  if(mode==='lease-loss')db.prepare("UPDATE authoring_chapters SET lease_owner='replacement',error='replacement-owned' WHERE id='chapter'").run();
  return Response.json({choices:[{message:{content:JSON.stringify({items,gaps})}}]});
};
try{
  const before=read();
  if(before.status==='paused')await controlAuthoringProject('teacher',scope,'project',before.revision,'resume');
  else if(before.chapters[0].status==='failed')await retryAuthoringChapter('teacher',scope,'project','chapter',before.chapters[0].revision);
  await kickAuthoringChapters();
  const project=read(),chapter=project.chapters[0],progress=chapter.selectionProgress;
  assert.equal(readAuthoringProject('other',scope,'project'),null);
  if(mode==='resume'){
    assert.equal(firstRound,2);assert.equal(selectionRequests,5);assert.equal(project.status,'paused');assert.equal(chapter.status,'pending');assert.equal(progress!.rounds,6);assert.equal(progress!.finished,true);assert.equal(progress!.selected,2);
  }else if(mode==='writer-failure'){
    assert.equal(selectionRequests,0);assert.equal(requests,1);assert.equal(chapter.status,'failed');assert.match(chapter.error!,/fixture-writer-stop/);assert.equal(progress!.finished,true);
  }else if(mode.startsWith('invalidate')){
    assert.equal(firstRound,1);assert.equal(selectionRequests,1);assert.equal(progress!.rounds,1);assert.match(progress!.resetReason!,/已变化/);assert.equal(project.status,'paused');
  }else if(mode==='lease-loss'){
    assert.equal(chapter.error,'replacement-owned');assert.equal(progress!.rounds,1);
  }else if(mode==='pause-compat'||mode==='pause-repair'){
    assert.equal(requests,1,'pause must prevent compatibility fallback and JSON repair requests');assert.equal(project.status,'paused');assert.equal(chapter.status,'pending');assert.equal(progress!.rounds,0);
  }else throw new Error(`Unexpected terminal mode ${mode}`);
  console.log(JSON.stringify({mode,requests,selectionRequests,status:project.status,rounds:progress?.rounds}));
}finally{globalThis.fetch=originalFetch;db.close();}
