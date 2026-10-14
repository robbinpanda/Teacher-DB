import assert from 'node:assert/strict';
import test from 'node:test';
import { formatImportedPaperName, MAX_IMPORT_BATCH_SIZE } from '../lib/import-paper-name.ts';
import { schoolPaperDetails } from '../lib/school-paper-name.ts';

const fields = { kind: 'mock', year: '', exam: '一模', region: '', school: '', qualifier: '' };
test('import batch allows 1000, independent of extraction concurrency', () => assert.equal(MAX_IMPORT_BATCH_SIZE, 1000));
test('mock names put the cohort and exam before the region', () => {
  assert.equal(formatImportedPaperName('一模_2021届__上海市嘉定区2020年数学一模.pdf', { ...fields, year: '2021', region: '上海市嘉定区' }), '2021年一模上海市嘉定区');
  assert.equal(formatImportedPaperName('2023-2024学年上海市二模答案.pdf', { ...fields, year: '2024', exam: '二模', region: '上海市', qualifier: '答案' }), '2024年二模上海市（答案）');
});
test('school exams follow year, school, exam and preserve missing fields as empty', () => {
  for (const exam of ['期中', '期末', '月考', '周考']) {
    assert.equal(formatImportedPaperName(`2025年上海中学${exam}.pdf`, { ...fields, kind: 'school', year: '2025', exam, school: '上海中学' }), `2025年上海中学${exam}`);
    assert.equal(formatImportedPaperName(`${exam}.pdf`, { ...fields, kind: 'school', exam }), exam);
  }
  assert.equal(formatImportedPaperName('浦东新区一模.pdf', { ...fields, region: '浦东新区' }), '一模浦东新区');
  assert.equal(formatImportedPaperName('2025年上海中学数学试卷.pdf', { ...fields, kind: 'school', year: '2025', exam: '', school: '上海中学' }), '2025年上海中学');
});
test('unsupported exam types and unrelated filenames stay unchanged', () => {
  const original = '2025年高考数学真题（解析版）.pdf';
  assert.equal(formatImportedPaperName(original, { ...fields, kind: 'other' }), original);
  assert.equal(formatImportedPaperName(original, fields), original);
  assert.equal(formatImportedPaperName('上海中学练习.pdf', { ...fields, kind: 'school', exam: '', school: '上海中学' }), '上海中学练习.pdf');
});
test('hallucinated years, schools, regions and qualifiers are never added', () => {
  assert.equal(formatImportedPaperName('一模.pdf', { ...fields, year: '2026', region: '上海市', qualifier: '答案' }), '一模');
  assert.equal(formatImportedPaperName('期末.pdf', { ...fields, kind: 'school', exam: '期末', school: '上海中学' }), '期末');
  assert.throws(() => formatImportedPaperName('一模.pdf', { ...fields, kind: 'unexpected' }));
});

test('school filenames retain grade, semester, month and exam even when the model omits exam', () => {
  const cases = [
    ['2024年上海中学高三上学期期中数学试题.pdf', '2024年上海中学高三上期中'],
    ['2024年上海中学高二（下）期末数学试卷.pdf', '2024年上海中学高二下期末'],
    ['上海中学2024年第一学期期中考试高三年级数学试卷.pdf', '2024年上海中学高三上期中'],
    ['2024年上海中学高三下学期4月月考数学试题.pdf', '2024年上海中学高三下4月月考'],
    ['2024年上海中学高三上学期十月月考数学试题.pdf', '2024年上海中学高三上10月月考'],
    ['2024年上海中学高三下开学考试数学.pdf', '2024年上海中学高三下开学考'],
    ['2024年上海中学高三第一学期数学周爽（十三）.pdf', '2024年上海中学高三上周爽13'],
    ['2024年上海中学高二上周练02.pdf', '2024年上海中学高二上周练2'],
    ['2024年上海中学高三上周测01和02.pdf', '2024年上海中学高三上周测1和2'],
    ['2024年上海中学高三下数学第十六周周练（解析版）.pdf', '2024年上海中学高三下周练16（解析版）'],
    ['2024年上海中学高三下模拟卷（一）数学试题.pdf', '2024年上海中学高三下模拟卷1'],
    ['2024年上海中学高二下模拟2数学试题.pdf', '2024年上海中学高二下模拟卷2'],
    ['2024年上海中学高三下5月第二次模拟数学.pdf', '2024年上海中学高三下5月模拟卷2'],
    ['2024年上海中学高三5月第二次模拟数学.pdf', '2024年上海中学高三5月模拟卷2'],
    ['2024年上海中学高三下模拟冲刺（3）数学.pdf', '2024年上海中学高三下模拟卷3'],
    ['2024年上海中学高三下周练卷数学_二_.pdf', '2024年上海中学高三下周练2'],
    ['2024年上海中学高三下阶段测试数学试卷一.pdf', '2024年上海中学高三下阶段测试1'],
  ];
  for (const [original, expected] of cases) assert.equal(formatImportedPaperName(original, { ...fields, kind: 'school', year: '2024', school: '上海中学', exam: '' }), expected, original);
});

test('missing evidence is not invented, school numbers are not exam numbers, dates are preserved', () => {
  const bare = schoolPaperDetails('2024届第十三中学高三月考.pdf');
  assert.equal(bare.grade, '高三'); assert.equal(bare.semester, ''); assert.equal(bare.month, ''); assert.equal(bare.sequence, '');
  const dated = schoolPaperDetails('上海中学2017-2018学年下学期高三周测（03.20）数学.pdf');
  assert.equal(dated.sequence, ''); assert.equal(dated.label, '3月周测（3.20）');
  assert.equal(schoolPaperDetails('上海中学高三模拟数学试卷（2019.05）.pdf').label, '5月模拟卷');
  assert.equal(schoolPaperDetails('上海中学高三下模拟（4月）数学试题.pdf').label, '4月模拟卷');
  assert.equal(schoolPaperDetails('学校中考联考数学试题（5月份）.pdf').label, '5月联考');
  assert.equal(schoolPaperDetails('高三三模数学.pdf').exam, '');
  assert.equal(schoolPaperDetails('高三上第一次周测（开学考）.pdf').label, '开学考（周测1）');
});
