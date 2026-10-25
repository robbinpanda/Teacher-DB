import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVariationQuestionUnchanged} from '../lib/variation-revision.ts';

const previous={stem:'若 x=2，求 x+1。',type:'fill',options:[],diagram:null,answer:'4',analysis:'原稿算错',tags:[],changeNote:'改变参数'};
test('只修正解答允许更正错答与解析，不强迫再改题干',()=>{
  assert.doesNotThrow(()=>assertVariationQuestionUnchanged(previous,{...previous,answer:'3',analysis:'2+1=3。'}));
});
test('只修正解答拒绝偷换条件、题型、选项或图形',()=>{
  for(const patch of [{stem:'若 x=3，求 x+1。'},{type:'answer'},{options:[{key:'A',content:'3'}]},{diagram:{version:1,kind:'coordinate',altText:'新图',elements:[]}}]) {
    assert.throws(()=>assertVariationQuestionUnchanged(previous,{...previous,...patch}),/不得修改上一版候选/);
  }
});
