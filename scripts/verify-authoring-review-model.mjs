// Optional live-model quality benchmark. Only newly authored synthetic text is sent.
// The original database is read only for the explicitly selected profile, never questions or assets.
// Run: JIANTI_REVIEW_TEST_PROFILE=<display name> node --import ./server/register.mjs --import tsx scripts/verify-authoring-review-model.mjs
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { loadEnvironment } from './env.mjs';
import { decryptSecret,encryptSecret } from '../lib/secret-box.ts';
import { getSqlite } from '../db/index.ts';
import { ensureDatabase } from '../db/bootstrap.ts';
import {authoringModel} from '../server/services/authoring-model.ts';
import {chapterReviewSystemPrompt,validateChapterReview} from '../lib/authoring-content.ts';
import {chapterReviewEvidence} from '../lib/authoring-review-evidence.ts';
import {authoringReviewChecks} from '../lib/authoring-review-checks.ts';
const profileName=process.env.JIANTI_REVIEW_TEST_PROFILE;
if(!profileName)throw new Error('Set JIANTI_REVIEW_TEST_PROFILE to an enabled OpenCode Go model display name; this optional verification makes paid model calls with synthetic text only.');
const root=process.cwd();loadEnvironment(root,'production');
const original=process.env.JIANTI_DATA_DIR||path.join(root,'data');process.env.JIANTI_DATA_DIR=original;
const source=new Database(path.join(original,'teacher-question-bank.sqlite3'),{readonly:true});
const profile=source.prepare("SELECT * FROM model_profiles WHERE display_name=? AND enabled=1").get(profileName);
if(!profile||new URL(profile.base_url).hostname!=='opencode.ai'||profile.service!=='opencode-go')throw new Error('Expected configured Go profile missing');
const key=await decryptSecret(profile.api_key_ciphertext,profile.api_key_iv);source.close();
const directory=path.join(root,'tmp','teacher-pilot','synthetic-review-challenge-'+Date.now());await mkdir(directory,{recursive:true});process.env.JIANTI_DATA_DIR=directory;
await ensureDatabase();const db=getSqlite(),secret=await encryptSecret(key);
const row={...profile,api_key_ciphertext:secret.ciphertext,api_key_iv:secret.iv},keys=Object.keys(row);
db.prepare(`INSERT INTO model_profiles(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
assert.equal(db.prepare('SELECT count(*) AS n FROM questions').get().n,0);
const id='math.high.trigonometry.period';
const paragraphs={
 domain:'设定义域为 D，非零数 T 为周期，是指对任意实数 x，x∈D 当且仅当 x+T∈D，且对所有 x∈D 有 f(x+T)=f(x)。因此 −T 也是周期。最小正周期只在所有正周期中取最小者，负数可以是周期但不可能是最小正周期。',
 constant:'y=A sin(ωx+φ)+b 和 y=A cos(ωx+φ)+b 在 Aω≠0 时的最小正周期为 2π/|ω|，这是基本三角函数的最小正周期定理经非零仿射变换的结论。A=0 或 ω=0 时在 R 上为常函数，任意非零数为周期，无最小正周期。但原式定义域不可丢失：y=0·tan x 的定义域仍为 R 去掉 π/2+kπ（k∈Z）；虽处处取值零，定义域保持条件迫使周期为非零整数倍 π，最小正周期仍为 π。',
 tangent:'y=A tan(ωx+φ)+b 在 Aω≠0 时定义域排除使内层角等于 π/2+kπ 的点，最小正周期为 π/|ω|。因为 tan(u+π)=tan u，且若 δ 是 tan u 的周期，取 u=0 得 tan δ=0，故 δ 为整数倍 π。周期性是全定义域的平移性质，可以跨越连续分支；单调性才需限在每个连续分支内。',
 absolute:'|sin x| 的最小正周期为 π：由 |sin(x+π)|=|sin x| 得 π 是周期；若 0<T<π 也是周期，取 x=0 得 |sin T|=0，故 T=kπ，与 0<T<π 矛盾。绝对值和平方变形可能缩短周期；sin²x 可降幂，|sin x| 一般不能恒等变换成单一正弦余弦函数。',
 minimum:'对 sin(ωx+φ)，ω≠0，取 x0=(π/2−φ)/ω。若 T>0 是任一周期，则 sin(π/2+ωT)=1，故 ωT=2kπ，k∈Z。由于 T>0，k 与 ω 同号且均非零，因此 T=2kπ/ω=2π|k|/|ω|，故任一正周期都是 2π/|ω| 的正整数倍。这个值本身确为周期，所以是最小正周期。不能仅排除 T/2 就声称排除了所有更小正周期。'
};
const variants=[
 {name:'correct',target:null},
 {name:'one-way-domain',target:'period.nonzero',replace:{domain:'设定义域 D，仅要求 x∈D 时 x+T∈D 且 f(x+T)=f(x)，即可定义非零数 T 为周期，无需反向定义域包含。在这个定义下，由把 x 换成 x−T 可直接断言 −T 总是周期，即使定义域只有 [0,+∞) 也一样。'}},
 {name:'constant-with-holes',target:'period.constant',replace:{constant:'A=0 时包括 y=0·tan x 在内的所有三角函数都退化为在 R 上的常函数，原来的无定义点可以直接补掉，所以任意非零数都是周期，没有最小正周期。'}},
 {name:'branch-only-period',target:'period.domain',replace:{tangent:'正切的周期结论只在每个连续区间内部成立，不能把周期平移跨过渐近线。'}},
 {name:'absolute-always-single',target:'period.absolute',replace:{absolute:'所有含绝对值的三角函数都可以恒等变换成单一正弦函数，特别是 |sin x|=sin x，因此最小正周期仍为 2π。'}},
 {name:'negative-omega-sign',target:'period.minimum',replace:{minimum:'对 sin(ωx+φ)，允许 ω<0。任意正周期 T 满足 ωT=2kπ，其中这个 k 必为正整数。于是 T=2kπ/|ω|，这就完成了包括 ω<0 在内的证明；取 ω=−2 也应在原等式 −2T=2kπ 中选 k=1 得最小正周期 π。'}}
];
console.log(JSON.stringify({directory,model:profile.display_name,cases:variants.length,privateQuestions:0}));const report=[];
for(const entry of variants){
 const content={introduction:'本章讨论周期函数定义、公式条件及最小性证明。',knowledge:[{id,title:'周期及最小性',explanation:Object.values({...paragraphs,...entry.replace}).join('\n\n'),formulas:[],method:'先检查原式定义域，再辨认函数类型，检查非零系数和最小正周期定理的适用条件，最后核验结论。',misconceptions:[{mistake:'仅凭两个点的函数值相同确定周期。',correction:'周期需对整个定义域满足平移不变性和函数值相等。'}]}],items:[],gaps:[],conclusion:'求周期必须保留原定义域，并区分某个周期与最小正周期。'};
 const checks=authoringReviewChecks([id]);let result,error;
 try{result=await authoringModel({ownerId:profile.owner_id,profileId:profile.id,system:chapterReviewSystemPrompt,text:JSON.stringify({content,checks,evidenceSources:chapterReviewEvidence(content),questions:[]}),purpose:'authoring_review_synthetic_challenge',jsonMode:true,maxOutputTokens:6000,timeoutMs:180000},value=>validateChapterReview(value,content,checks));}catch(e){error=String(e);}
 const passed=Boolean(result&&(entry.target?result.value.checks.some(c=>c.id===entry.target&&!c.passed):result.value.passed));
 await writeFile(path.join(directory,entry.name+'.json'),JSON.stringify({content,expectedFailure:entry.target,result,error},null,2));
 report.push({name:entry.name,passed,error,checks:result?.value.checks.map(c=>({id:c.id,passed:c.passed,reason:c.reason})),traceId:result?.traceId});console.log(JSON.stringify({name:entry.name,passed,error}));
}
await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));db.close();if(report.some(r=>!r.passed))process.exitCode=1;
