// Live OpenCode Go check with authored synthetic questions only; never reads bank questions/assets.
import Database from 'better-sqlite3';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadEnvironment} from './env.mjs';
import {decryptSecret,encryptSecret} from '../lib/secret-box.ts';
import {getSqlite} from '../db/index.ts';
import {ensureDatabase} from '../db/bootstrap.ts';
import {authoringModel} from '../server/services/authoring-model.ts';
import {chapterReviewSystemPrompt,validateChapterReview} from '../lib/authoring-content.ts';

const profileName=process.env.JIANTI_REVIEW_TEST_PROFILE;
if(!profileName)throw new Error('Set JIANTI_REVIEW_TEST_PROFILE; this optional benchmark sends synthetic text to the selected OpenCode Go profile.');
const root=process.cwd();loadEnvironment(root,'production');
const original=process.env.JIANTI_DATA_DIR||path.join(root,'data');process.env.JIANTI_DATA_DIR=original;
const source=new Database(path.join(original,'teacher-question-bank.sqlite3'),{readonly:true});
const profile=source.prepare('SELECT * FROM model_profiles WHERE display_name=? AND enabled=1').get(profileName);
if(!profile||new URL(profile.base_url).hostname!=='opencode.ai'||profile.service!=='opencode-go')throw new Error('Expected enabled OpenCode Go profile');
const key=await decryptSecret(profile.api_key_ciphertext,profile.api_key_iv);source.close();
const directory=path.join(root,'tmp/teacher-pilot','synthetic-answer-review-'+Date.now());await mkdir(directory,{recursive:true});process.env.JIANTI_DATA_DIR=directory;
await ensureDatabase();const db=getSqlite(),secret=await encryptSecret(key),row={...profile,api_key_ciphertext:secret.ciphertext,api_key_iv:secret.iv},keys=Object.keys(row);
db.prepare(`INSERT INTO model_profiles(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
assert.equal(db.prepare('SELECT count(*) n FROM questions').get().n,0);
const cases=[
 ['angle','半径为3，圆心角为120°的扇形，其弧长是多少？','2π','π'],
 ['definition','角α的终边经过点(−3,4)，求sinα。','4/5','3/5'],
 ['same-angle','sinα=3/5，α在第二象限，求cosα。','−4/5','4/5'],
 ['reduction','用cos x表示cos(π+x)。','−cos x','cos x'],
 ['graphs','写出y=tan x的定义域。','{x∈R | x≠π/2+kπ，k∈Z}','R'],
 ['period','y=sin(2x)的最小正周期是多少？','π','2π'],
 ['symmetry','写出y=sin x的全部竖直对称轴。','x=π/2+kπ，k∈Z','x=kπ，k∈Z'],
 ['monotonicity','y=−sin x在闭区间[−π/2,π/2]上是严格递增还是严格递减？','严格递减','严格递增'],
 ['extrema','y=sin x在开区间(0,π/6)上有没有最大值？若有求出，若没有说明理由。','没有最大值；上确界1/2无法取到。','最大值为1/2。'],
 ['parameters','将y=sin(2x)的图象向左平移多少个单位可以得到y=sin(2x+π/3)？求最小正平移量。','π/6','π/3'],
 ['sum','求sin75°的精确值。','(√6+√2)/4','(√6−√2)/4'],
 ['double','已知cosα=1/3，求cos2α。','−7/9','7/9'],
 ['identity','y=sin x+cos x的振幅是多少？','√2','2'],
 ['model','水位模型h(t)=3+2sin(πt/6)，t单位为小时，模型的最小正周期是多少小时？','12小时','6小时'],
];
const report=[];console.log(JSON.stringify({directory,model:profile.display_name,syntheticQuestions:28,privateQuestions:0}));
for(let start=0;start<cases.length;start+=7){
 const expected=new Map();
 const questions=cases.slice(start,start+7).flatMap(([topic,stem,right,wrong])=>[wrong,right].map((answer,index)=>{
  const id='q-'+createHash('sha256').update('answer-benchmark-v2:'+topic+':'+index).digest('hex').slice(0,16);
  expected.set(id,{topic,expectedFailure:index===0,expectedAnswer:right});
  return {id,type:'fill',stem,options:[],answer,analysis:'请核验参考答案。',tags:[],figures:[]};
 })).sort((a,b)=>a.id.localeCompare(b.id));
 const content={introduction:'本章是三角函数专项练习，所有题目均需核对原题答案。',knowledge:[],
  items:questions.map((q,i)=>({slotIndex:i,questionId:q.id,selectionReason:'同一考点练习，检查基本概念与公式条件。',teachingExplanation:''})),gaps:[],conclusion:'完成练习后回顾定义、公式条件与容易遗漏的限制。'};
 const payload={plan:{title:'三角函数练习答案核验',slots:questions.map(()=>({role:'practice',type:'fill'}))},checks:[],evidenceSources:[],content,questions,imageMapping:[]};
 let result,error;
 try{result=await authoringModel({ownerId:profile.owner_id,profileId:profile.id,system:chapterReviewSystemPrompt,text:JSON.stringify(payload),purpose:'authoring_answer_review_synthetic',jsonMode:true,maxOutputTokens:10000,timeoutMs:240000},value=>validateChapterReview(value,content));}catch(e){error=String(e);}
 const outcomes=questions.map(q=>{const check=result?.value.questionChecks?.find(c=>c.id===q.id);const failed=check?!check.solvable||!check.answerCorrect||!check.explanationCorrect:result?.value.issues.some(issue=>issue.startsWith(q.id+'：'));return {id:q.id,...expected.get(q.id),failed,matched:result!==undefined&&failed===expected.get(q.id).expectedFailure,check};});
 await writeFile(path.join(directory,'batch-'+start+'.json'),JSON.stringify({payload,result,error,outcomes},null,2));
 report.push(...outcomes);console.log(JSON.stringify({batch:start,matched:outcomes.filter(c=>c.matched).length,total:outcomes.length,error}));
}
await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));db.close();if(report.some(c=>!c.matched))process.exitCode=1;
