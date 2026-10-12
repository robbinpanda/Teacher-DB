import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'question-library-browser' } });

test('个人题库按真实来源筛选，知识点折叠且平台资源不混入个人题目', async ({ page }) => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, 'teacher-question-bank.sqlite3'));
  const stamp = new Date().toISOString();
  for (const kind of ['uploaded', 'imported', 'generated']) {
    const doc = crypto.randomUUID();
    db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,source_kind,status,subject,grade,created_at,updated_at) VALUES (?,'question-library-browser',?,'application/pdf',?,'complete','数学','九年级',?,?)").run(doc, kind, kind, stamp, stamp);
    db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,status,needs_human_review,page_number,bbox_json,created_at,updated_at) VALUES (?,?,'1','fill',?,'1','approved',0,1,'{}',?,?)").run(crypto.randomUUID(), doc, `${kind} 测试题干 $x^2=1$`, stamp, stamp);
  }
  await page.goto('/bank');
  await expect(page.locator('.question-card')).toHaveCount(3);
  await expect(page.getByRole('complementary', { name: '题库文件夹' })).toHaveCount(0);
  await page.getByRole('button', { name: '文件夹管理' }).click();
  await expect(page.getByRole('complementary', { name: '题库文件夹' })).toBeVisible();
  await page.getByRole('button', { name: '文件夹管理' }).click();
  await expect(page.getByLabel('筛选知识点')).toBeVisible();
  await expect(page.locator('.tag-filters')).toHaveCount(0);
  await page.locator('.bank-more-filters summary').click();
  await page.getByLabel('题目来源类型').selectOption('imported');
  await expect(page.locator('.question-card')).toHaveCount(1);
  await expect(page.locator('.question-card')).toContainText('imported 测试题干');
  await page.locator('.bank-more-filters summary').click();
  await page.getByPlaceholder('搜索题干、答案、知识点或来源').fill('不存在的题干');
  await expect(page.getByRole('heading', { name: '没有匹配的题目' })).toBeVisible();
  await page.getByRole('tab', { name: '基础题库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '平台精选资源尚未开放' })).toBeVisible();
  await expect(page.locator('.question-card')).toHaveCount(0);
  await page.getByRole('tab', { name: '我的题库', exact: true }).click();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.question-card')).toHaveCount(3);
  for (const width of [1366,1440,1680,1920]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 1440) await page.screenshot({ path: 'tmp/question-library-1440.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  db.close();
});
