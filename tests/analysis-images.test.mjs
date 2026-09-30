import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisImageParts, mapCandidateImageMarkers, remapAnalysisImages } from '../lib/analysis-images.ts';

test('候选编号转为持久图片序号，未选图片不能引用', () => {
  assert.equal(mapCandidateImageMarkers('前[[image:p5-2]]中[[image:p8-1]]后[[image:bad]]', ['p8-1', 'p5-2']), '前[[image:2]]中[[image:1]]后');
});
test('图片穿插在文字中，重复标记不重复显示，旧图片仍保留', () => {
  assert.deepEqual(analysisImageParts('甲[[image:2]]乙[[image:2]]丙[[image:99]]', 3), [
    {text:'甲'}, {image:1}, {text:'乙'}, {text:'丙'}, {text:''}, {image:0}, {image:2},
  ]);
});
test('删除和调整图片用途不使标记错配下一张图；导出可重编号', () => {
  const a = [{id:'a',role:'answer'},{id:'b',role:'answer'},{id:'c',role:'question'}];
  assert.equal(remapAnalysisImages('甲[[image:1]]乙[[image:2]]', a, [a[1],a[2]]), '甲乙[[image:1]]');
  assert.equal(remapAnalysisImages('[[image:1]][[image:2]]', a, [a[1],a[0]]), '[[image:2]][[image:1]]');
});
