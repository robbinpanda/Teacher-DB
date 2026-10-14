import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPdfPages, browserPdfConcurrency, boundedPdfScale, MAX_PAGE_PIXELS } from '../lib/pdf-render.ts';

function fixture(failure) {
  const state = { destroyed: 0, cleaned: 0, canvases: [] };
  const task = { destroy: async () => { state.destroyed++; }, promise: failure === 'parse' ? Promise.reject(new Error('parse')) : Promise.resolve({
    numPages: 3, getPage: async () => ({
      getViewport: ({scale}) => ({width: 600 * scale, height: 800 * scale}),
      render: () => ({promise: failure === 'render' ? Promise.reject(new Error('render')) : Promise.resolve()}),
      cleanup: () => {state.cleaned++;},
    }),
  }) };
  const canvas = () => {
    const c = { width: 0, height: 0, getContext: () => ({}), toBlob: cb => cb(failure === 'encode' ? null : new Blob(['jpeg'])) };
    state.canvases.push(c); return c;
  };
  return { state, task, canvas };
}

for (const failure of [undefined, 'parse', 'ready', 'render', 'encode', 'upload']) test(`PDF resources are released after ${failure ?? 'success'}`, async () => {
  const {state,task,canvas} = fixture(failure);
  const run = renderPdfPages(task, async () => {if(failure === 'ready') throw new Error('ready');}, async page => {
    assert.ok(page.width > 0 && page.height > 0);
    assert.equal(state.canvases.at(-1).width, 0, 'canvas pixels are freed before uploading');
    if(failure === 'upload') throw new Error('upload');
  }, canvas);
  if(failure) await assert.rejects(run); else await run;
  assert.equal(state.destroyed, 1);
  assert.equal(state.cleaned, failure === 'parse' || failure === 'ready' ? 0 : failure ? 1 : 3);
  assert.ok(state.canvases.every(c => c.width === 0 && c.height === 0));
});

test('large PDF pages and browser concurrency stay bounded independently of recognition', () => {
  for(const count of [10,15,20,30,100]) assert.equal(browserPdfConcurrency(count), 2);
  assert.equal(browserPdfConcurrency(1),1);
  for(const [w,h] of [[600,800],[100000,100000],[100000,100]]) {
    const scale=boundedPdfScale(w,h);
    assert.ok(Math.floor(w*scale)*Math.floor(h*scale)<=MAX_PAGE_PIXELS);
    assert.ok(w*scale<=4096 && h*scale<=4096);
  }
  assert.throws(()=>boundedPdfScale(Infinity,10));
});
