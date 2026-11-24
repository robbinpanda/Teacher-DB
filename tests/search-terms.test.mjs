import assert from 'node:assert/strict';
import test from 'node:test';
import { searchGroups } from '../lib/search-terms.ts';

const vocabulary = [
  { kind: 'school', name: '上海交通大学附属中学', aliases: ['交大附中', '上海交大附中', '交附'] },
  { kind: 'school', name: '上海交通大学附属中学嘉定分校', aliases: ['交大附中嘉定分校', '交大嘉定'] },
  { kind: 'school', name: '上海市民办交大南洋中学', aliases: [] },
  { kind: 'exam', name: '期中', aliases: ['期中考试', '期中考'] },
];
const texts = (groups) => groups.map(group => group.map(item => item.text));
// A canonical paper name must satisfy every group through at least one spelling.
const matches = (name, query) => searchGroups(query, vocabulary).every(group => group.some(item => name.includes(item.text)));
const paper = '2024年上海交通大学附属中学高三上期中（试卷+解析）';

test('a year glued to a school abbreviation becomes two conditions', () => {
  const groups = texts(searchGroups('2024交大附中', vocabulary));
  assert.deepEqual(groups[0], ['2024']);
  assert.ok(groups[1].includes('上海交通大学附属中学'));
  assert.ok(matches(paper, '2024交大附中'));
});

test('a bare school fragment reaches every school whose spelling contains it', () => {
  const [, school] = texts(searchGroups('2024交大', vocabulary));
  assert.ok(school.includes('交大'));
  assert.ok(school.includes('上海交通大学附属中学'));
  assert.ok(school.includes('上海交通大学附属中学嘉定分校'));
  assert.ok(matches(paper, '2024交大'));
});

test('grade, semester and exam words split out in any order', () => {
  for (const query of ['2024交大附中高三期中', '交大附中 期中 2024', '2024年交大附中高三上学期期中考试', '2024，交附']) {
    assert.ok(matches(paper, query), query);
  }
  assert.ok(!matches(paper, '2023交大附中'));
  assert.ok(!matches(paper, '2024交大附中期末'));
});

test('the longest school spelling wins over its prefix', () => {
  const groups = texts(searchGroups('交大附中嘉定分校', vocabulary));
  assert.equal(groups.length, 1);
  assert.ok(groups[0].includes('上海交通大学附属中学嘉定分校'));
  assert.ok(!groups[0].includes('上海交通大学附属中学'));
});

test('formulas and plain words pass through untouched', () => {
  assert.deepEqual(texts(searchGroups('向量', vocabulary)), [['向量']]);
  assert.deepEqual(texts(searchGroups('x^2+1', vocabulary)), [['x^2+1']]);
  assert.deepEqual(searchGroups('   ', vocabulary), []);
});
