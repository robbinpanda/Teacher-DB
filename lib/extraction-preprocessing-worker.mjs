import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { readSourceQuestionInventory } from './source-question-inventory.ts';
import { detectAssetCandidates, annotateAssetCandidates } from './asset-candidates.ts';

sharp.concurrency(1);
parentPort.on('message', async (job) => {
  const started = performance.now();
  try {
    let sourceInventory = null, inventoryError;
    parentPort.postMessage({ type: 'progress', phase: 'inventory', completedPages: 0 });
    if (job.originalPath) {
      try { sourceInventory = await readSourceQuestionInventory(await readFile(job.originalPath), job.pages.length); }
      catch (error) { inventoryError = error instanceof Error ? error.message : String(error); }
    }
    const inventoryMs = performance.now() - started;
    const modelImages = [], candidates = [], pageBytes = [];
    let totalBytes = 0, detectMs = 0, annotateMs = 0, hasPageContent = false;
    for (const page of job.pages) {
      const bytes = await readFile(page.path);
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > 20 * 1024 * 1024) throw Object.assign(new Error(`第 ${page.pageNumber} 页图像超过 20 MB`), { code: 'page_too_large' });
      if (totalBytes > 120 * 1024 * 1024) throw Object.assign(new Error('整份试卷图像总量超过 120 MB，请降低 PDF 清晰度后重新上传'), { code: 'document_too_large' });
      if (!hasPageContent) {
        const thumbnail = await sharp(bytes).resize({ width: 128, withoutEnlargement: true }).greyscale().raw().toBuffer();
        hasPageContent = thumbnail.some(value => value < 245);
      }
      let step = performance.now();
      const found = await detectAssetCandidates(bytes);
      detectMs += performance.now() - step;
      const boxes = found.candidates.map(box => ({ ...box, id: `p${page.pageNumber}-${box.id}` }));
      candidates.push(...boxes.map(box => ({ ...box, page: page.pageNumber, pageWidth: found.width, pageHeight: found.height })));
      step = performance.now();
      const annotated = await annotateAssetCandidates(bytes, boxes);
      annotateMs += performance.now() - step;
      modelImages.push({ page: page.pageNumber, dataUrl: `data:image/jpeg;base64,${annotated.toString('base64')}` });
      // Own the backing store so transfer releases it from this worker without copying in the parent.
      pageBytes.push({ page: page.pageNumber, bytes: Uint8Array.from(bytes) });
      parentPort.postMessage({ type: 'progress', phase: 'images', completedPages: page.pageNumber });
    }
    if (!hasPageContent) throw Object.assign(new Error('整卷分页图为空白，PDF 解码可能失败；请重新渲染原卷，不能继续调用模型识别空白页'), { code: 'page_images_blank' });
    parentPort.postMessage({ type: 'result', result: { sourceInventory, inventoryError, modelImages, candidates, pageBytes,
      timings: { inventoryMs: Math.round(inventoryMs), detectMs: Math.round(detectMs), annotateMs: Math.round(annotateMs), totalMs: Math.round(performance.now() - started), pages: job.pages.length } } }, pageBytes.map(page => page.bytes.buffer));
  } catch (error) {
    parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error), code: error?.code });
  }
});
