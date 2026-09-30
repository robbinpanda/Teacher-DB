import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { parseCandidateSelection } from '../lib/asset-review.ts';
import { detectAssetCandidates } from '../lib/asset-candidates.ts';
const candidate={id:'p5-1',page:5,pageWidth:1000,pageHeight:1400,x:80,y:84,width:220,height:196};
const selected={id:'p5-1',kind:'graph',role:'answer',label:'跨页答案图'};
const parse=(assets,extra={})=>parseCandidateSelection(JSON.stringify({assets,expectedImageCount:assets.length,missingImages:[],needsHumanReview:false,unlocatedImages:false,...extra}),[candidate]);
test('模型仅选择编号，不能覆盖实际像素边界',()=>{
 const result=parse([{...selected,bbox:{x:0,y:0,width:1,height:1}}]);
 assert.equal(result.assets[0].page,5);assert.equal(result.assets[0].role,'answer');
 for(const [key,value] of Object.entries({x:8,y:6,width:22,height:14}))assert.ok(Math.abs(result.assets[0].bbox[key]-value)<1e-10);
});
test('未知编号转人工补图；拒绝重复选择和非法归属；漏框必须待核查',()=>{
 const unknown=parse([{...selected,id:'p9-1'}]);assert.equal(unknown.assets.length,0);assert.equal(unknown.missingImages.length,1);assert.equal(unknown.needsHumanReview,true);
 assert.throws(()=>parse([selected,selected]));assert.throws(()=>parse([{...selected,role:'other'}]));
 assert.equal(parse([],{unlocatedImages:true}).needsHumanReview,true);assert.match(parse([],{unlocatedImages:true}).notes,/手动补框/);
 assert.throws(()=>parseCandidateSelection('null',[candidate]));
});

test('无候选框的原页仍可反馈缺图，且数量不匹配不能默认为完整',()=>{
 const report={assets:[],expectedImageCount:1,missingImages:[{page:4,role:'answer',description:'页面顶部坐标图',reason:'无候选框'}],needsHumanReview:false,unlocatedImages:false};
 const r=parseCandidateSelection(JSON.stringify(report),[],[4,5]);
 assert.equal(r.missingImages[0].page,4);assert.equal(r.needsHumanReview,true);
 assert.throws(()=>parseCandidateSelection(JSON.stringify(report),[],[5]));
 assert.equal(parse([],{expectedImageCount:1}).missingImages.length,1);
});
test('像素定位保留完整表格，排除分离的题干和页眉',async()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="982" height="600"><rect width="982" height="600" fill="white"/><path d="M80 90H600 M80 130H600" stroke="black" stroke-width="2"/><rect x="80" y="170" width="320" height="110" fill="none" stroke="black" stroke-width="2"/><path d="M80 225H400 M180 170V280 M280 170V280" stroke="black" stroke-width="2"/></svg>';
 const bytes=await sharp(Buffer.from(svg)).png().toBuffer();const {candidates}=await detectAssetCandidates(bytes);
 assert.equal(candidates.length,1);const box=candidates[0];assert.ok(Math.abs(box.x-75)<=2);assert.ok(Math.abs(box.y-165)<=2);assert.ok(box.y+box.height>=283);assert.ok(box.y>130);
});

test('无外边框茎叶图会合并细竖线与分散数字',async()=>{
 const digits=Array.from({length:5},(_,row)=>[95,130,150,175].map(x=>`<rect x="${x}" y="${175+row*18}" width="6" height="10" fill="black"/>`).join('')).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="982" height="600"><rect width="982" height="600" fill="white"/><path d="M110 170V270" stroke="black"/>${digits}</svg>`;
 const {candidates}=await detectAssetCandidates(await sharp(Buffer.from(svg)).png().toBuffer());
 assert.equal(candidates.length,1);const box=candidates[0];assert.ok(box.x<=95&&box.x+box.width>=181);assert.ok(box.y<=170&&box.y+box.height>=270);
});

test('封闭表格上方相距很近的页眉不进入裁剪框',async()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="982" height="600"><rect width="982" height="600" fill="white"/><path d="M90 160H300" stroke="black" stroke-width="3"/><rect x="80" y="170" width="320" height="110" fill="none" stroke="black" stroke-width="2"/></svg>';
 const {candidates}=await detectAssetCandidates(await sharp(Buffer.from(svg)).png().toBuffer());
 assert.equal(candidates.length,1);assert.ok(candidates[0].y>=165);
});
