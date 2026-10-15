import test from 'node:test';
import assert from 'node:assert/strict';
import { paginatePaper } from '../lib/paper-pagination.ts';

const answer = (contentHeight = 100, extra = {}) => ({ sectionId: 'answer', contentHeight, headingHeight: 40, answer: true, minimumBlank: 0, ...extra });

test('简答题每页两题，题目和留白合计至少半页', () => {
  const pages = paginatePaper(Array.from({ length: 5 }, () => answer()), 960, 0, 20);
  assert.deepEqual(pages.map(page => page.columns[0].length), [2, 2, 1]);
  for (const page of pages) for (const item of page.columns[0]) {
    assert.ok(item.blank >= 100);
    assert.ok(item.blank + 100 + (item.heading ? 40 : 0) >= 480);
  }
});

test('长题独占一页，留白不短于题干，不以固定高度截断', () => {
  const pages = paginatePaper([answer(350), answer(300), answer(100)], 960, 0, 20);
  assert.deepEqual(pages.map(page => page.columns[0].map(item => item.index)), [[0], [1], [2]]);
  assert.equal(pages[0].columns[0][0].blank, 350);
});

test('超长题的留白跨页延续且总量不少于题干', () => {
  const pages = paginatePaper([answer(650)], 960, 0, 20);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].columns[0][0].continuation, true);
  assert.equal(pages.flatMap(page => page.columns.flat()).reduce((sum, item) => sum + item.blank, 0), 650);
});

test('双栏客观题后简答题另起单栏页，保留卷首空间和题序', () => {
  const blocks = [answer(350, { answer: false, sectionId: 'fill' }), answer(350, { answer: false, sectionId: 'fill' }), answer(), answer()];
  const pages = paginatePaper(blocks, 960, 300, 20, 2);
  assert.equal(pages[0].columns.length, 2);
  assert.deepEqual(pages[0].columns.map(column => column.map(item => item.index)), [[0], [1]]);
  assert.equal(pages[1].columns.length, 1);
  assert.deepEqual(pages[1].columns[0].map(item => item.index), [2, 3]);
});

test('选择填空排完剩余恰好半页时，接排一道简答题，后续仍每页两题', () => {
  const objective = answer(320, { answer: false, sectionId: 'fill' });
  const pages = paginatePaper([objective, answer(), answer(), answer()], 960, 100, 20);
  assert.deepEqual(pages.map(page => page.columns[0].map(item => item.index)), [[0, 1], [2, 3]]);
  assert.equal(pages[0].columns[0][1].blank, 340);
});

test('剩余不足半页或长题加等高留白放不下时，整题换页', () => {
  for (const [objectiveHeight, contentHeight, minimumBlank] of [[321, 100, 0], [320, 300, 0], [320, 100, 400]]) {
    const pages = paginatePaper([answer(objectiveHeight, { answer: false, sectionId: 'fill' }), answer(contentHeight, { minimumBlank })], 960, 100, 20);
    assert.deepEqual(pages.map(page => page.columns[0].map(item => item.index)), [[0], [1]]);
    assert.ok(pages[1].columns[0][0].blank >= contentHeight);
  }
});

test('双栏客观题下方剩余半页时，简答题跨整行接排', () => {
  const pages = paginatePaper([answer(320, { answer: false, sectionId: 'fill' }), answer(), answer()], 960, 100, 20, 2);
  assert.deepEqual(pages[0].columns.map(items => items.map(item => item.index)), [[0], []]);
  assert.deepEqual(pages[0].answers.map(item => item.index), [1]);
  assert.deepEqual(pages[1].columns[0].map(item => item.index), [2]);
});

test('双栏以较高的一栏为准，不能侵入另一栏已占用区域', () => {
  const pages = paginatePaper([answer(500, { answer: false, sectionId: 'fill' }), answer(300, { answer: false, sectionId: 'fill' }), answer()], 960, 100, 20, 2);
  assert.deepEqual(pages[0].columns.map(items => items.map(item => item.index)), [[0], [1]]);
  assert.deepEqual(pages[0].answers, []);
  assert.deepEqual(pages[1].columns[0].map(item => item.index), [2]);
});
