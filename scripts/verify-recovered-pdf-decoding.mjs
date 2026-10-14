// Regression check against the locally retained source PDFs. Intercepts all uploads.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const plan = JSON.parse(readFileSync('tmp/stuck-page-repair-plan.json', 'utf8'));
const documentIds = ['8c0daac5-1f69-49b6-b2eb-ab7a8da2422d', 'd08fe6d6-b265-44ce-ae9f-25d1a5488775'];
const sources = documentIds.map(id => plan.find(p => p.document_id === id));
assert.ok(sources.every(Boolean));
const expectedPages = plan.filter(p => documentIds.includes(p.document_id)).length;
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const page = await browser.newPage();
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.log('browser:', message.text()); });
  page.on('pageerror', error => console.log('pageerror:', error.message));
  const results = [], events = [], assets = [], errors = [];
  await page.route('**/api/model-profiles', route => route.fulfill({ json: { profiles: [], selectedProfileId: '' } }));
  const uploadIds = new Map();
  await page.route('**/api/documents', route => {
    if (route.request().method() !== 'POST') return route.continue();
    const name = route.request().postDataBuffer().toString().match(/filename="([^"]+)"/)?.[1];
    assert.ok(name);
    if (!uploadIds.has(name)) uploadIds.set(name, crypto.randomUUID());
    return route.fulfill({ json: { id: uploadIds.get(name), status: 'uploading' } });
  });
  await page.route('**/api/documents/*/pages', async route => {
    try {
      const request = route.request();
      const form = await new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postDataBuffer() }).formData();
      const file = [...form.values()].find(value => typeof value !== 'string' && value.size > 0);
      assert.ok(file, 'uploaded page must contain an image');
      const stats = await sharp(Buffer.from(await file.arrayBuffer())).grayscale().stats();
      assert.ok(stats.channels[0].min < 245, 'decoded PDF page must contain visible content');
      results.push({ min: stats.channels[0].min, mean: stats.channels[0].mean });
      await route.fulfill({ json: { id: crypto.randomUUID() } });
    } catch (error) { errors.push(error.message); await route.fulfill({ status: 400, json: { error: error.message } }); }
  });
  await page.route('**/api/documents/*', route => route.request().method() === 'PATCH' ? route.fulfill({ json: { ok: true } }) : route.continue());
  await page.route('**/api/documents/*/queue', route => route.fulfill({ json: { queued: false } }));
  await page.route('**/api/runtime-events', route => { events.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  page.on('response', response => { if (response.url().includes('/api/pdf-assets/')) assets.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto('http://127.0.0.1:3050/');
  await page.getByRole('button', { name: '导入试卷', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入试卷' });
  await dialog.getByLabel('选择 PDF 文件').setInputFiles(sources.map((source, i) => ({ name: `decoder-regression-${i}.pdf`, mimeType: 'application/pdf', buffer: readFileSync(path.join('data/files', source.original_key)) })));
  await dialog.getByRole('button', { name: '开始导入' }).click();
  const deadline = Date.now() + 120000;
  while (events.filter(e => e.event === 'pdf_end').length < sources.length && Date.now() < deadline) await page.waitForTimeout(500);
  assert.deepEqual(errors, []);
  if (events.some(e => e.event === 'pdf_error')) console.log(await dialog.innerText());
  assert.equal(events.filter(e => e.event === 'pdf_error').length, 0, JSON.stringify(events));
  assert.equal(results.length, expectedPages);
  assert.ok(assets.some(asset => asset.path.endsWith('/openjpeg.wasm') && asset.status === 200), JSON.stringify(assets));
  assert.ok(assets.some(asset => asset.path.endsWith('/jbig2.wasm') && asset.status === 200), JSON.stringify(assets));
  const invalid = await page.request.get('http://127.0.0.1:3050/api/pdf-assets/unknown/package.json');
  assert.equal(invalid.status(), 404);
  console.log(JSON.stringify({ ok: true, decodedPages: results.length, darkestPixel: Math.min(...results.map(p => p.min)), assets }));
} finally { await browser.close(); }
