import assert from "node:assert/strict";
import { ensureDatabase } from "../db/bootstrap.ts";
import { getSqlite } from "../db/index.ts";
import { encryptSecret } from "../lib/secret-box.ts";
import { createAuthoringProject, kickAuthoringPlanning, readAuthoringProject, saveAuthoringPlan, inspectAuthoringCoverage } from "../server/services/authoring.ts";
import { fingerprintRow, loadRetrievalRows, rankQuestions } from "../lib/knowledge-retrieval.ts";
import { saveClassification, classifyQuestion } from "../server/services/question-classification.ts";

await ensureDatabase();
const db=getSqlite(), scope={subject:"数学",stage:"high" as const}, time=new Date().toISOString();
const secret=await encryptSecret("test-secret-not-a-real-key");
db.prepare(`INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at)
 VALUES('model','teacher','Mock','openai-compatible','https://model.invalid/v1','mock',?,?,'test',?,?)`).run(secret.ciphertext,secret.iv,time,time);
db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('doc','teacher','周期练习','application/pdf','complete','数学','高三',?,?)").run(time,time);
db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES('q','doc','1','fill','求最小正周期。','π','周期等于二π除以角系数。','approved',1,'{}',?,?)").run(time,time);
const period="math.high.trigonometry.period";
const slot={role:"example",knowledgeIds:[period],difficulty:2,type:"fill",count:1,score:0,purpose:"直接应用周期公式"};
const plan={title:"三角函数周期讲义",audience:"高三基础班",approach:"从图象周期到解析式计算，逐步迁移",estimatedMinutes:45,assumptions:["已掌握弧度制"],chapters:[{id:"period",title:"周期的概念与计算",objectives:["能求三角函数的最小正周期"],knowledgeIds:[period],prerequisites:[],teachingNotes:"从单位圆解释周期，不只记忆公式。",slots:[slot,{...slot,role:"practice"}]}]};
const profile={knowledge:[{id:period,evidence:"题干要求计算最小正周期。"}],methods:["公式变形"],competencies:["数学运算"],difficulty:2,difficultyReason:"直接识别角系数后应用周期公式。",prerequisites:[],confidence:.9};
let response: unknown=plan;
let calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(response)}}],usage:{prompt_tokens:20,completion_tokens:30}});};
try {
 const input={kind:"handout",instruction:"给高三学生制作周期专题讲义",requiredKnowledgeIds:[period],profileId:"model",documentIds:["doc"]};
 const project=await createAuthoringProject("teacher",scope,input);
 assert.equal(project.status,"queued");
 assert.equal(readAuthoringProject("other",scope,project.id),null);
 assert.equal(readAuthoringProject("teacher",{...scope,stage:"middle"},project.id),null);
 await assert.rejects(()=>createAuthoringProject("other",scope,input),/模型配置/);
 await assert.rejects(()=>createAuthoringProject("teacher",scope,{...input,documentIds:["other-doc"]}),/已审核/);
 await kickAuthoringPlanning();
 const planned=readAuthoringProject("teacher",scope,project.id)!;
 assert.equal(planned.status,"planned");assert.deepEqual(planned.plan,plan);assert.equal(calls,1);
 await kickAuthoringPlanning();assert.equal(calls,1,"completed plans must not run again");
 const saved=saveAuthoringPlan("teacher",scope,project.id,planned.revision,{...plan,title:"修改后的讲义"});
 assert.equal(saved.title,"修改后的讲义");
 assert.throws(()=>saveAuthoringPlan("teacher",scope,project.id,planned.revision,plan),/变化/);
 assert.equal(inspectAuthoringCoverage("teacher",scope,project.id)[0].slots[0].confirmedCount,0);
 const row=loadRetrievalRows(db,"teacher",scope,undefined,["q"])[0],fingerprint=fingerprintRow(row,scope);
 saveClassification("teacher",scope,"q",fingerprint,profile,"confirmed");
 assert.equal(inspectAuthoringCoverage("teacher",scope,project.id)[0].slots[0].confirmedCount,1);
 assert.throws(()=>saveClassification("teacher",scope,"q",fingerprint,profile,"suggested"),/不能覆盖/);
 assert.throws(()=>saveClassification("other",scope,"q",fingerprint,profile,"confirmed"));
 db.prepare("UPDATE questions SET answer='2π' WHERE id='q'").run();
 assert.equal(rankQuestions(loadRetrievalRows(db,"teacher",scope),scope,{confirmedOnly:true}).total,0);
 assert.throws(()=>saveClassification("teacher",scope,"q",fingerprint,profile,"confirmed"),/变化/);
 response=profile;
 assert.equal((await classifyQuestion("teacher",scope,"q","model")).status,"suggested");

 response={invalid:true};
 const failed=await createAuthoringProject("teacher",scope,input);await kickAuthoringPlanning();
 assert.equal(readAuthoringProject("teacher",scope,failed.id)!.status,"failed");
 response=plan;
 const recovered=await createAuthoringProject("teacher",scope,input);
 db.prepare("UPDATE authoring_projects SET status='planning',lease_owner='dead',lease_expires_at='2000-01-01' WHERE id=?").run(recovered.id);
 await kickAuthoringPlanning();assert.equal(readAuthoringProject("teacher",scope,recovered.id)!.status,"planned");
 const live=await createAuthoringProject("teacher",scope,input);
 db.prepare("UPDATE authoring_projects SET status='planning',lease_owner='live',lease_expires_at='2099-01-01' WHERE id=?").run(live.id);
 const before=calls;await kickAuthoringPlanning();assert.equal(calls,before,"do not restart a live lease");
 // A late response from an old lease must not overwrite the replacement worker's state.
 const stale=await createAuthoringProject("teacher",scope,input);
 globalThis.fetch=async()=>{db.prepare("UPDATE authoring_projects SET lease_owner='replacement',title='new owner' WHERE id=?").run(stale.id);return Response.json({choices:[{message:{content:JSON.stringify(plan)}}]});};
 await kickAuthoringPlanning();assert.equal(readAuthoringProject("teacher",scope,stale.id)!.title,"new owner");
 console.log("authoring verification passed: planning, tenant/scope isolation, stale labels, revision conflicts, failure, recovery, live leases, stale result rejection");
} finally {globalThis.fetch=originalFetch;db.close();}
