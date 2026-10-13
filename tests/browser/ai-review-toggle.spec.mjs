import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';

test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'review-toggle-browser' } });

test('独立 AI 复核默认关闭，可开关并持久保存，账户隔离且不改变队列暂停状态', async ({ page, request }) => {
  await request.patch('/api/extraction-queue', { data: { action: 'pause' } });
  const initial = await (await request.get('/api/extraction-queue')).json();
  expect(initial.automaticAiReviewEnabled).toBe(false);
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: '独立 AI 复核', exact: true });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(toggle).toBeChecked();
  const enabled = await (await request.get('/api/extraction-queue')).json();
  expect(enabled.automaticAiReviewEnabled).toBe(true);
  expect(enabled.paused).toBe(true);
  expect(enabled.concurrency).toBe(initial.concurrency);
  const other = await request.get('/api/extraction-queue', { headers: { 'oai-authenticated-user-id': 'other-review-toggle' } });
  expect((await other.json()).automaticAiReviewEnabled).toBe(false);
  expect((await request.patch('/api/extraction-queue', { data: { automaticAiReviewEnabled: 'false' } })).status()).toBe(400);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('未启用的识别任务显示复核已关闭，保存失败不会伪装为开启', async ({ page }) => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, 'teacher-question-bank.sqlite3'));
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,created_at,updated_at) VALUES (?,'review-toggle-browser','关闭复核试卷','application/pdf','extracting',1,?,?)").run(id, stamp, stamp);
  db.prepare("INSERT INTO document_jobs (document_id,owner_id,status,question_total,completed_question_numbers_json,lease_expires_at,queued_at,updated_at) VALUES (?,'review-toggle-browser','processing',8,'[\"1\",\"2\"]','2099-01-01',?,?)").run(id, stamp, stamp);
  try {
    await page.goto('/');
    await expect(page.getByText('AI 复核已关闭', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '关闭复核试卷 识别进度' })).toHaveAttribute('aria-valuetext', '2/8 题');
    await expect(page.getByRole('progressbar', { name: '关闭复核试卷 AI复核进度' })).toHaveCount(0);
    await page.route('**/api/extraction-queue', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { error: '设置保存失败' } }) : route.continue());
    const toggle = page.getByRole('switch', { name: '独立 AI 复核' });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('.wb-ai-review-setting').getByRole('alert')).toContainText('设置保存失败');
  } finally { db.prepare('DELETE FROM document_jobs WHERE document_id=?').run(id); db.prepare('DELETE FROM documents WHERE id=?').run(id); db.close(); }
});
