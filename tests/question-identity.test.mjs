import test from 'node:test';
import assert from 'node:assert/strict';
import {comparableQuestionText as textKey,questionIdentityKey as key} from '../lib/question-identity.ts';
import {parseVariationModelContent} from '../lib/question-variations.ts';

test('去重保留分数分组、运算括号、区间边界、大小写和上标的数学区别',()=>{
 for(const [a,b] of [
  [String.raw`求 $\frac{1}{23}$`,String.raw`求 $\frac{12}{3}$`],
  ['$x^{12}$','$x^1 2$'],['$(x+1)^2$','$x+1^2$'],['$[0,1]$','$(0,1)$'],
  ['$1.2$','$12$'],['$A$','$a$'],['$x²$','$x2$'],['$ℝ$','$R$'],
  [String.raw`$\sin x$`,String.raw`$\sinx$`],['$a b$','$ab$'],['$\{1,2\}$','$12$'],
 ])assert.notEqual(textKey(a),textKey(b),`${a} versus ${b}`);
 assert.equal(textKey(String.raw`求 $\dfrac{1}{2} \left(x+1\right)$`),textKey(String.raw`求 \(\frac {1}{2}(x + 1)\)`));
 assert.equal(textKey('求（x＋1）'),textKey('求 (x+1)'));
});

test('同题干的不同选项或题图保留，解析和答案配图不同不会重复占题量',()=>{
 const q={id:'one',type:'single',stem:'如图，选择正确结论。',options:[{key:'A',content:'1'},{key:'B',content:'2'}],assets:[{id:'image',role:'question',cropKey:'first.png'}]};
 assert.notEqual(key(q),key({...q,options:[{key:'A',content:'1'},{key:'B',content:'3'}]}));
 assert.notEqual(key(q),key({...q,assets:[{...q.assets[0],cropKey:'second.png'}]}));
 assert.equal(key(q),key({...q,type:'multiple'}));
 assert.equal(key(q),key({...q,options:[{key:'A',content:'2'},{key:'B',content:'1'}]}));
 assert.equal(key(q),key({...q,id:'copy',answer:'different stored answer',assets:[...q.assets,{id:'solution',role:'answer',cropKey:'solution.png'}]}));
 assert.equal(key(q),key({id:'row',type:q.type,stem:q.stem,optionsJson:JSON.stringify(q.options),assetsJson:JSON.stringify(q.assets)}));
 assert.notEqual(key({...q,assets:[{id:'unknown',role:'question'}]}),key({...q,id:'copy',assets:[{id:'unknown',role:'question'}]}));
 assert.notEqual(key({id:'a',stem:'x',optionsJson:'invalid'}),key({id:'b',stem:'x',optionsJson:'invalid'}));
});

test('变式选项校验不把不同区间和运算括号当作重复内容，仍拒绝排版重复',()=>{
 const base={type:'single',stem:'函数在以下哪个区间递增？',answer:'A',analysis:'根据定义域和单调性检查端点。',tags:[],changeNote:'改变区间端点'};
 const parse=contents=>parseVariationModelContent({content:JSON.stringify({variations:[{...base,options:contents.map((content,i)=>({key:String.fromCharCode(65+i),content}))}]}),count:1,sourceType:'single',sourceStem:'原题不同的条件',allowedTags:[],fallbackTags:[]});
 for(const pair of [['$[0,1]$','$(0,1)$'],['$(x+1)^2$','$x+1^2$'],['$1.2$','$12$'],['$A$','$a$']])assert.equal(parse(pair).length,1);
 assert.throws(()=>parse([String.raw`$\dfrac{1}{2}$`,String.raw`$\frac {1} {2}$`]),/重复选项内容/);
});
