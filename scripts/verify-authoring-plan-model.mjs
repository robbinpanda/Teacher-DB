// Synthetic teacher instructions only. No questions/documents/assets are read or copied.
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { loadEnvironment } from './env.mjs';
import { decryptSecret,encryptSecret } from '../lib/secret-box.ts';
import { getSqlite } from '../db/index.ts';
import { ensureDatabase } from '../db/bootstrap.ts';
import { createAuthoringProject,kickAuthoringPlanning,readAuthoringProject } from '../server/services/authoring.ts';
const profileName=process.env.JIANTI_PLAN_TEST_PROFILE;
if(!profileName)throw new Error('Set JIANTI_PLAN_TEST_PROFILE to an enabled OpenCode Go display name; this optional benchmark sends synthetic instructions only.');
const root=process.cwd();loadEnvironment(root,'production');
const original=process.env.JIANTI_DATA_DIR||path.join(root,'data');process.env.JIANTI_DATA_DIR=original;
const source=new Database(path.join(original,'teacher-question-bank.sqlite3'),{readonly:true});
const profile=source.prepare("SELECT * FROM model_profiles WHERE display_name=? AND enabled=1").get(profileName);
if(!profile||new URL(profile.base_url).hostname!=='opencode.ai'||profile.service!=='opencode-go')throw new Error('Expected configured Go profile missing');
const key=await decryptSecret(profile.api_key_ciphertext,profile.api_key_iv);source.close();
const directory=path.join(root,'tmp','teacher-pilot','synthetic-requirements-'+Date.now());await mkdir(directory,{recursive:true});process.env.JIANTI_DATA_DIR=directory;
await ensureDatabase();const db=getSqlite(),secret=await encryptSecret(key);
const row={...profile,api_key_ciphertext:secret.ciphertext,api_key_iv:secret.iv},keys=Object.keys(row);
db.prepare(`INSERT INTO model_profiles(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
assert.equal(db.prepare('SELECT count(*) AS n FROM questions').get().n,0);
const scope={subject:'数学',stage:'high'};
const cases=[
 {name:'school-book',kind:'book',instruction:'从题库选题制作一本高三三角函数校本教辅，完整覆盖三角函数全部知识点，每章一个具体考点。每个知识点两道例题、四道练习，按前置知识先后组织，例题和练习各自由易到难。每章包含概念解释、公式适用条件、误区辨析和完整例题解析；资料不足时明确缺口，不编造题目。',check:p=>{assert.equal(p.kind,'book');assert.equal(p.plan.chapters.length,14);assert.equal(p.summary.questionCount,84);assert.equal(p.summary.knowledgeCount,14);assert.ok(p.requirements.numeric.some(n=>n.scope==='eachKnowledge'&&n.roles.includes('practice')&&n.value===4));}},
 {name:'paper-arithmetic',kind:'paper',instruction:'出一份高三三角函数周期专题试卷，共十二道题：六道单选每题五分，四道填空每题五分，两道解答每题二十五分，总分一百分，考试时间一个半小时。',check:p=>{assert.equal(p.summary.questionCount,12);assert.equal(p.summary.totalScore,100);assert.equal(p.plan.estimatedMinutes,90);assert.ok(p.requirements.numeric.some(n=>n.metric==='scorePerQuestion'&&n.types.includes('answer')&&n.value===25));}},
 {name:'percent',kind:'paper',instruction:'出一份三角函数周期专题检测，共二十道题，全部为填空题，每题五分，总分一百分，六十分钟。基础题占六成，提高题占四成；基础指难度1或2，提高指难度4或5。',check:p=>{assert.equal(p.summary.questionCount,20);assert.equal(p.summary.totalScore,100);assert.equal(p.requirements.numeric.filter(n=>n.metric==='percent').length,2);}},
 {name:'full-trig',kind:'handout',instruction:'制作高三一轮复习讲义，完整覆盖三角函数全部知识点，按前置知识先后安排，每章只教一个具体考点。每章两道例题和四道练习，难度逐步提高，包含完整知识讲解、条件、易错点和例题解析。',check:p=>{assert.equal(p.plan.chapters.length,14);assert.equal(p.summary.questionCount,84);assert.ok(p.requirements.knowledge.some(n=>n.id==='math.high.trigonometry'));assert.ok(p.requirements.numeric.some(n=>n.scope==='eachChapter'&&n.roles.includes('practice')&&n.value===4));}},
];
const selected=cases.filter(entry=>!process.env.JIANTI_PLAN_TEST_CASE||entry.name===process.env.JIANTI_PLAN_TEST_CASE);
if(!selected.length)throw new Error('Unknown JIANTI_PLAN_TEST_CASE');
const results=[];console.log(JSON.stringify({phase:'prepared',directory,privateQuestions:0,images:0,syntheticInstructions:selected.length}));
for(const entry of selected){const project=await createAuthoringProject(profile.owner_id,scope,{kind:entry.kind,instruction:entry.instruction,profileId:profile.id});await kickAuthoringPlanning();const result=readAuthoringProject(profile.owner_id,scope,project.id);let checked=false,error=result.error;try{assert.equal(result.status,'planned');entry.check(result);assert.ok(result.requirementChecks.every(c=>c.passed));checked=true;}catch(e){error=result.error||String(e);}
 await writeFile(path.join(directory,entry.name+'.json'),JSON.stringify(result,null,2));results.push({name:entry.name,checked,status:result.status,error});console.log(JSON.stringify(results.at(-1)));}
await writeFile(path.join(directory,'report.json'),JSON.stringify(results,null,2));db.close();if(results.some(r=>!r.checked))process.exitCode=1;
