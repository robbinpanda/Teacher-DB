import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBasketItems, basketStorageKey, readBasketIds, BASKET_LIMIT } from '../lib/question-basket.ts';

test('选题篮跨账号、学科和学段隔离，键名不会发生分隔符碰撞', () => {
  const keys = [['a','数学','junior'],['b','数学','junior'],['a','英语','junior'],['a','数学','senior'],['a:b','c','d'],['a','b:c','d']].map(args => basketStorageKey(...args));
  assert.equal(new Set(keys).size, keys.length);
});
test('恢复选题保留顺序去重，拒绝损坏数据而非伪装空篮', () => {
  assert.deepEqual(readBasketIds(null), []);
  assert.deepEqual(readBasketIds('["b","a","b"]'), ['b','a']);
  for (const raw of ['{', '{}', '[null]', '[""]', '[1]', JSON.stringify(Array(BASKET_LIMIT + 1).fill('a'))]) assert.throws(() => readBasketIds(raw));
});
test('批量追加保留原顺序且幂等，超限时不修改原选题', () => {
  const current = [{id:'b'}, {id:'a'}];
  assert.deepEqual(appendBasketItems(current, [{id:'a'}, {id:'c'}]), [{id:'b'}, {id:'a'}, {id:'c'}]);
  assert.equal(current.length, 2);
  const full = Array.from({length:BASKET_LIMIT}, (_,i) => ({id:String(i)}));
  assert.throws(() => appendBasketItems(full, [{id:'overflow'}]));
  assert.equal(full.length, BASKET_LIMIT);
});
