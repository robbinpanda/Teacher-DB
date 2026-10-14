import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { prepareExtractionInput, closePreprocessingWorkers, PREPROCESSING_CONCURRENCY } from '../lib/extraction-preprocessing.ts';
import { detectAssetCandidates } from '../lib/asset-candidates.ts';

test('bounded preprocessing preserves candidate IDs, page bytes and progress; failures release slots', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'preprocess-'));
  try {
    const bytes = await sharp(Buffer.from('<svg width="500" height="600"><rect width="500" height="600" fill="white"/><rect x="50" y="70" width="180" height="130" fill="none" stroke="black" stroke-width="3"/></svg>')).jpeg().toBuffer();
    const file = path.join(directory, 'page.jpg'); await writeFile(file, bytes);
    const expected = await detectAssetCandidates(bytes);
    const input = { pages: [{ pageNumber: 1, path: file }] };
    const active = new Set(); let maxActive = 0;
    const jobs = Array.from({ length: 8 }, (_, index) => prepareExtractionInput(input, progress => {
      if (progress.phase === 'inventory') { active.add(index); maxActive = Math.max(maxActive, active.size); }
    }).then(result => { active.delete(index); return result; }));
    const results = await Promise.all(jobs);
    assert.ok(maxActive <= PREPROCESSING_CONCURRENCY);
    for (const result of results) {
      assert.deepEqual(Buffer.from(result.pageBytes[0].bytes), bytes);
      assert.deepEqual(result.candidates.map(({ page, pageWidth, pageHeight, ...box }) => { assert.equal(page, 1); assert.equal(pageWidth, 500); assert.equal(pageHeight, 600); return box; }), expected.candidates.map(box => ({ ...box, id: `p1-${box.id}` })));
      assert.match(result.modelImages[0].dataUrl, /^data:image\/jpeg;base64,/);
      assert.equal(result.timings.pages, 1);
    }
    await assert.rejects(prepareExtractionInput({ pages: [{ pageNumber: 1, path: path.join(directory, 'missing.jpg') }] }), /ENOENT/);
    await assert.rejects(prepareExtractionInput(input, () => { throw new Error('lease lost'); }), /lease lost/);
    const blank = path.join(directory, 'blank.jpg');
    await sharp({create:{width:500,height:600,channels:3,background:'white'}}).jpeg().toFile(blank);
    await assert.rejects(prepareExtractionInput({pages:[{pageNumber:1,path:blank}]}), {code:'page_images_blank'});
    assert.equal((await prepareExtractionInput(input)).pageBytes.length, 1);
  } finally { await closePreprocessingWorkers(); await rm(directory, { recursive: true, force: true }); }
});
