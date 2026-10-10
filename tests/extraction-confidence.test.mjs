import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionConfidence } from '../lib/extraction-confidence.ts';
import { normalizeStreamedQuestion, wholeDocumentSystemPrompt } from '../lib/document-extraction.ts';
import { ASSET_REVIEW_SYSTEM_PROMPT } from '../lib/asset-review.ts';

test('问题评分只能降低，非有限值归零，不会把低分补成上限',()=>{
 assert.equal(extractionConfidence(0.2,{correctedAssets:true}),0.2);
 assert.equal(extractionConfidence(0.99,{correctedAssets:true}),0.65);
 assert.equal(extractionConfidence(0.99,{missingImages:true}),0.5);
 for(const value of [NaN,Infinity,'bad',undefined])assert.equal(extractionConfidence(value),0);
});
test('整卷标准化也执行缺图及人工核查评分上限',()=>{
 const input={number:'1',stem:'题干',confidence:0.99,needsHumanReview:false};
 const normalize=value=>normalizeStreamedQuestion({...input,...value},{pageCount:1,allowedTags:[]});
 assert.equal(normalize({}).confidence,0.99);
 assert.equal(normalize({needsHumanReview:true}).confidence,0.65);
 const missing=normalize({missingImages:[{page:1,role:'question',description:'坐标图',reason:'无候选框'}]});
 assert.equal(missing.confidence,0.5);assert.equal(missing.needsHumanReview,true);assert.equal(missing.status,'needs_attention');
});
test('提示词区分不等式组和真实图表，评分和图数没有固定示例',()=>{
 for(const prompt of [wholeDocumentSystemPrompt,ASSET_REVIEW_SYSTEM_PROMPT]){
  assert.match(prompt,/不等式组/);assert.match(prompt,/LaTeX/);assert.match(prompt,/置信度|confidence/);
  assert.doesNotMatch(prompt,/"confidence"\s*:\s*0\.95/);
  assert.doesNotMatch(prompt,/"expectedImageCount"\s*:\s*\d/);
 }
});
