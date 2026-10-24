import assert from 'node:assert/strict';
import sharp from 'sharp';
import { putFile } from '../lib/file-storage.ts';
import { ensureDatabase } from '../db/bootstrap.ts';
import { getSqlite } from '../db/index.ts';
import { encryptSecret } from '../lib/secret-box.ts';
import { generateVariationCandidates, getVariationRun } from '../server/services/variation-candidates.ts';
import { acceptVariationCandidates } from '../server/services/variation-acceptance.ts';

await ensureDatabase();
const db = getSqlite(), now = new Date().toISOString(), secret = await encryptSecret('synthetic-test-key');
db.prepare("INSERT INTO model_profiles(id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_mask,created_at,updated_at) VALUES('model','teacher','Mock','openai-compatible','https://model.invalid/v1','mock',?,?,'test',?,?)").run(secret.ciphertext,secret.iv,now,now);
db.prepare("INSERT INTO documents(id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES('doc','teacher','合成原卷','application/pdf','complete','数学','高三',?,?)").run(now,now);
db.prepare("INSERT INTO questions(id,document_id,number,type,stem,answer,analysis,status,page_number,bbox_json,created_at,updated_at) VALUES('source','doc','1','fill','求 1+1 的值。','2','直接相加。','approved',1,'{}',?,?)").run(now,now);
await putFile('assets/source.png',await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer());
db.prepare("INSERT INTO question_assets(id,question_id,kind,role,label,crop_key,bbox_json,created_at) VALUES('source-image','source','figure','question','原题图','assets/source.png','{}',?)").run(now);
const drafts = [2,3,4,5].map(n => ({stem:`求 ${n}+${n} 的值。`,type:'fill',options:[],answer:String(n*2),analysis:`直接相加得 ${n*2}。`,tags:[],changeNote:'改变加数，保持整数加法目标。',diagram:null}));
let mode = 'fallback', count = 1, calls: string[] = [], reviewedIndex = -1;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  const text = body.messages.map((message: {content:string | Array<{text?:string}>}) => typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('\n')).join('\n');
  let output: unknown;
  if (text.includes('逐题核查可解性')) {
    const source=JSON.parse(text.split('原题对照：')[1].split('。最终题目：')[0]);
    assert.equal(source.answer,'2');assert.equal(source.analysis,'直接相加。');assert.deepEqual(source.options,[]);
    assert.ok(body.messages.some((message:{content:unknown})=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url')),'final verifier must receive original question images');
    calls.push(`verify:${reviewedIndex}`);
    const bad = mode === 'all-fail' || (['fallback','low-score'].includes(mode) && reviewedIndex === 0);
    output = { checks: [{index:1,score:mode === 'low-score' && bad ? 74 : 90,solvable:true,answerCorrect:mode === 'low-score' ? true : !bad,objectiveAligned:true,difficultyAligned:true,explanation:bad ? '独立复算发现答案有误，不能使用。' : '逐步相加复算一致，目标与难度保持。'}] };
  } else if (text.includes('独立审校与修订 Agent')) {
    const source=JSON.parse(text.split('原题（仅作对照）：')[1].split('\n')[0]);
    assert.equal(source.answer,'2');assert.equal(source.analysis,'直接相加。');assert.deepEqual(source.options,[]);
    const candidateText = text.split('候选题（JSON，仅作审校）：')[1].split('\n')[0];
    const [candidate] = JSON.parse(candidateText);
    reviewedIndex = drafts.findIndex(q => q.stem === candidate.stem);
    assert.ok(reviewedIndex >= 0);
    calls.push(`review:${reviewedIndex}`);
    if (mode === 'network') return Response.json({error:'unauthorized'},{status:401});
    if (mode === 'malformed' && reviewedIndex === 0) output = {reviews:[]};
    else output = {reviews:[{index:1,verdict:'pass',issues:[],finalVariation: mode === 'duplicate' && reviewedIndex === 1 ? drafts[0] : candidate}]};
  } else if (text.includes(`规划 ${count+1} 道变式`)) {
    calls.push('plan');
    output = {objective:'整数加法',prerequisites:'整数运算',difficultyRationale:'同为一步加法',misconception:'加法运算错误',changes:drafts.slice(0,count+1).map(q=>q.changeNote)};
  } else { calls.push('generate'); output = {variations:drafts.slice(0,count+1)}; }
  return Response.json({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]});
};
async function run(nextMode: string, nextCount = 1, qualityMode = 'reviewed') {
  mode = nextMode; count = nextCount; calls = [];
  const response = await generateVariationCandidates('teacher','source',{count,qualityMode,difficulty:'similar',diagramMode:'never',profileId:'model',idempotencyKey:crypto.randomUUID()});
  return {status:response.status,body:await response.json()};
}
const fallback = await run('fallback');
assert.equal(fallback.status,201,JSON.stringify(fallback.body));
assert.deepEqual(calls,['plan','generate','review:0','verify:0','review:1','verify:1']);
assert.equal(fallback.body.candidates[0].question.stem,drafts[1].stem);
assert.equal(fallback.body.workflow.rejectedCandidateCount,1);
assert.match(fallback.body.workflow.rejectedCandidates[0],/最终复核/);
assert.equal(fallback.body.workflow.verification[0].index,1);
assert.equal(fallback.body.workflow.verification[0].candidateIndex,2);
const restored = await getVariationRun('teacher',fallback.body.runId);
assert.equal(restored!.candidates[0].question.stem,drafts[1].stem);
assert.equal(await getVariationRun('other',fallback.body.runId),null);
assert.equal((await acceptVariationCandidates('teacher',fallback.body.runId,{candidateIds:[fallback.body.candidates[0].id]})).status,200,'alternate keeps the standard adoption gate');
assert.equal((await run('low-score')).status,201);
assert.ok(calls.includes('review:1'));
assert.equal((await run('malformed')).status,201);
assert.deepEqual(calls,['plan','generate','review:0','review:0','review:1','verify:1']);
const allFailed = await run('all-fail');
assert.equal(allFailed.status,502); assert.match(allFailed.body.error,/只有 0 道/);
assert.equal((db.prepare('SELECT count(*) n FROM variation_candidates WHERE run_id=?').get(allFailed.body.runId) as {n:number}).n,0);
const duplicate = await run('duplicate',2);
assert.equal(duplicate.status,201);
assert.deepEqual(duplicate.body.candidates.map((c:{question:{stem:string}})=>c.question.stem),[drafts[0].stem,drafts[2].stem]);
assert.deepEqual(duplicate.body.workflow.verification.map((c:{index:number;candidateIndex:number})=>[c.index,c.candidateIndex]),[[1,1],[2,3]]);
assert.equal(duplicate.body.workflow.rejectedCandidateCount,1);
assert.equal((await run('network')).status,502);
assert.deepEqual(calls,['plan','generate','review:0'],'transport failure must not spend calls on alternates');
assert.equal((await run('pass')).status,201);
assert.deepEqual(calls,['plan','generate','review:0','verify:0'],'stop as soon as requested count passes');
assert.equal((await run('pass',1,'quick')).status,201);
assert.deepEqual(calls,['plan','generate']);
db.close();
console.log('Variation alternates: quality fallback, bounded correction, strict scoring, duplicate revision, isolation, persistence/adoption, early stop and transport failure passed.');
