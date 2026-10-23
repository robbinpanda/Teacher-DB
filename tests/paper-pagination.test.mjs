import test from 'node:test';
import assert from 'node:assert/strict';
import { paginatePaper } from '../lib/paper-pagination.ts';
const answer = (contentHeight = 100, extra = {}) => ({ sectionId: 'answer', contentHeight, headingHeight: 40, answer: true, minimumBlank: 0, ...extra });
const items = pages => pages.flatMap(page => [...page.columns.flat(), ...(page.answers ?? [])]);

test('自动留白不强制半页，短解答题连续排版且题序不变', () => {
  const pages = paginatePaper(Array.from({length:5}, () => answer()), 960, 0, 20);
  assert.equal(pages.length, 1);
  assert.deepEqual(items(pages).map(item => item.index), [0,1,2,3,4]);
  assert.ok(items(pages).every(item => item.blank === 80 && !item.continuation));
});
test('图片高度不增加默认作答留白，宽图与多图按实际占高排版', () => {
  const plain = items(paginatePaper([answer(100)],960,0,20))[0];
  const figure = items(paginatePaper([answer(500,{figureHeight:400})],960,0,20))[0];
  assert.equal(plain.blank, figure.blank);
  assert.equal(figure.blank,80);
});
test('长题自动留白适应剩余空间，不产生只含作答区的额外页', () => {
  const pages = paginatePaper([answer(900)],960,0,20);
  assert.equal(pages.length,1);
  assert.equal(items(pages)[0].blank,20);
  assert.ok(items(pages).every(item=>!item.continuation));
});
test('只有用户明确设置的大段留白才续页，留白总量不丢失', () => {
  const pages=paginatePaper([answer(650,{minimumBlank:650})],960,0,20);
  assert.equal(pages.length,2);
  assert.equal(pages[1].columns[0][0].continuation,true);
  assert.equal(items(pages).reduce((sum,item)=>sum+item.blank,0),650);
});
test('答案解析模式不恢复学生卷设置的作答留白', () => {
  const pages = paginatePaper([answer(100, { answer: false, minimumBlank: 1200 })], 960, 0, 20);
  assert.equal(pages.length, 1);
  assert.equal(items(pages)[0].blank, 0);
});
test('窄图右侧空间可用于作答，但不抵消用户明确设置的留白', () => {
  assert.equal(items(paginatePaper([answer(300,{figureHeight:200,sideAnswerHeight:200})],960,0,20))[0].blank,0);
  assert.equal(items(paginatePaper([answer(300,{figureHeight:200,sideAnswerHeight:200,minimumBlank:400})],960,0,20))[0].blank,400);
});
test('双栏客观题下方可接排跨整行解答题，不侵入较高的一栏', () => {
  const pages=paginatePaper([answer(500,{answer:false,sectionId:'fill'}),answer(300,{answer:false,sectionId:'fill'}),answer()],960,100,20,2);
  assert.deepEqual(pages[0].columns.map(column=>column.map(item=>item.index)),[[0],[1]]);
  assert.deepEqual(pages[0].answers.map(item=>item.index),[2]);
});
test('剩余空间不足时整题换页；每个常规页面均不超过可用高度', () => {
  const blocks=[answer(420,{answer:false,sectionId:'fill'}),answer(400,{figureHeight:300}),answer(200),answer(700,{figureHeight:600})];
  const pages=paginatePaper(blocks,960,100,20);
  assert.deepEqual(items(pages).map(item=>item.index),[0,1,2,3]);
  for(const page of pages) for(const column of page.columns){
    const height=column.reduce((sum,item)=>{const b=blocks[item.index];return sum+b.contentHeight+(item.heading?b.headingHeight:0)+item.blank+(b.answer?0:20);},page.header?100:0);
    assert.ok(height<=960,`height=${height}`);
  }
});
