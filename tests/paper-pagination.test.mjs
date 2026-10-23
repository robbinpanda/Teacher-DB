import test from 'node:test';
import assert from 'node:assert/strict';
import { paginatePaper } from '../lib/paper-pagination.ts';

const answer = (contentHeight = 100, extra = {}) => ({ sectionId: 'answer', contentHeight, headingHeight: 40, answer: true, minimumBlank: 0, ...extra });

test('答案解析模式不恢复学生卷设置的作答留白', () => {
  const pages = paginatePaper([answer(100, { answer: false, minimumBlank: 1200 })], 960, 0, 20);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].columns[0][0].blank, 0);
});

test('每道解答题下方独立保留半页，题干不抵扣留白', () => {
  const pages = paginatePaper(Array.from({ length: 5 }, () => answer()), 960, 0, 20);
  assert.deepEqual(pages.map(page => page.columns[0].length), [1, 1, 1, 1, 1]);
  for (const page of pages) assert.equal(page.columns[0][0].blank, 480);
});

test('含图题与长题也至少留半页，超长题留白不少于题干', () => {
  for (const height of [100, 300, 350, 650]) {
    const pages = paginatePaper([answer(height)], 960, 0, 20);
    const items = pages.flatMap(page => page.columns.flat());
    assert.equal(items.reduce((sum, item) => sum + item.blank, 0), Math.max(480, height));
    assert.ok(pages.every(page => page.columns.flat().length));
    if (height === 650) assert.equal(items[1].continuation, true);
  }
});

test('手动较小留白不能压缩半页下限，较大设置完整保留', () => {
  for (const minimumBlank of [0, 100, 400, 600, 1200]) {
    const pages = paginatePaper([answer(300, { minimumBlank })], 960, 0, 20);
    assert.equal(pages.flatMap(page => page.columns.flat()).reduce((sum, item) => sum + item.blank, 0), Math.max(480, minimumBlank));
  }
});

test('双栏客观题后解答题另起单栏，题序与半页留白不变', () => {
  const blocks = [answer(350, { answer: false, sectionId: 'fill' }), answer(350, { answer: false, sectionId: 'fill' }), answer(), answer()];
  const pages = paginatePaper(blocks, 960, 300, 20, 2);
  assert.deepEqual(pages[0].columns.map(column => column.map(item => item.index)), [[0], [1]]);
  assert.deepEqual(pages.slice(1).map(page => page.columns[0].map(item => item.index)), [[2], [3]]);
  for (const page of pages.slice(1)) assert.equal(page.columns[0][0].blank, 480);
});

test('剩余恰好半页但放不下题干和半页作答区时整题换页', () => {
  const pages = paginatePaper([answer(320, { answer: false, sectionId: 'fill' }), answer()], 960, 100, 20);
  assert.deepEqual(pages.map(page => page.columns[0].map(item => item.index)), [[0], [1]]);
  assert.equal(pages[1].columns[0][0].blank, 480);
});

test('客观题后空间足够时接排，单栏双栏均保留完整半页作答区', () => {
  for (const columns of [1, 2]) {
    const pages = paginatePaper([answer(100, { answer: false, sectionId: 'fill' }), answer()], 960, 100, 20, columns);
    assert.equal(pages.length, 1);
    const items = [...pages[0].columns.flat(), ...(pages[0].answers ?? [])];
    assert.deepEqual(items.map(item => item.index), [0, 1]);
    assert.equal(items[1].blank, 480);
  }
});

test('双栏以较高的一栏为准，不能侵入另一栏已占用区域', () => {
  const pages = paginatePaper([answer(500, { answer: false, sectionId: 'fill' }), answer(300, { answer: false, sectionId: 'fill' }), answer()], 960, 100, 20, 2);
  assert.deepEqual(pages[0].columns.map(items => items.map(item => item.index)), [[0], [1]]);
  assert.deepEqual(pages[0].answers, []);
  assert.deepEqual(pages[1].columns[0].map(item => item.index), [2]);
});
