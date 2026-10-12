import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';

test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'paper-library-browser' } });
test('两类试卷统一管理，恢复编排不会加入其他题目，保存更新同一作品', async ({ page, request }) => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, 'teacher-question-bank.sqlite3'));
  const stamp = new Date().toISOString(), doc = crypto.randomUUID(), paper = crypto.randomUUID();
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES (?,'paper-library-browser','原卷链路测试','application/pdf','complete','数学','高三',?,?)").run(doc, stamp, stamp);
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  ids.forEach((id, i) => db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,status,needs_human_review,page_number,bbox_json,created_at,updated_at) VALUES (?,?,?,'fill',?,'1','approved',0,1,'{}',?,?)").run(id, doc, String(i+1), `链路题目${i+1}`, stamp, stamp));
  const settings = { templateId: 'preset-homework', subject: '数学', stage: 'high', sections: [{ id: 'one', title: '恢复分组', acceptedTypes: ['fill'], questionIds: [ids[1], ids[0]], defaultScore: 6 }], notice: '恢复注意事项', style: { bodySize: 14 }, answerSpaces: { [ids[0]]: 40 } };
  const response = await request.post('/api/papers', { data: { id: paper, title: '组卷链路测试', subtitle: '保留副标题', questionIds: [ids[1], ids[0]], settings } });
  expect(response.status()).toBe(201);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const width of [1366, 1440, 1680, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/papers');
    await expect(page.locator('.asset-table tbody tr')).toHaveCount(2);
    if (width === 1440) await page.screenshot({ path: 'tmp/paper-library-1440.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('tab', { name: /上传原卷/ }).click();
  await expect(page.locator('.asset-table tbody tr')).toHaveCount(1);
  await page.getByLabel('原卷链路测试 操作').click();
  await expect(page.getByText('下载试卷 PDF', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '进入相关题目' }).click();
  await expect(page.locator('.question-card')).toHaveCount(3);
  await page.goto('/papers');
  await page.getByRole('tab', { name: /组卷作品/ }).click();
  await page.getByRole('link', { name: '继续编辑', exact: true }).click();
  await expect(page.locator('input[value="组卷链路测试"]')).toBeVisible();
  await expect(page.locator('.printable-paper')).toContainText('链路题目2');
  await expect(page.locator('.printable-paper')).not.toContainText('链路题目3');
  await page.getByRole('button', { name: '保存试卷', exact: true }).click();
  await expect(page.locator('.paper-save-state')).toContainText('已保存');
  expect(db.prepare('SELECT COUNT(*) FROM papers WHERE id=?').pluck().get(paper)).toBe(1);
  expect(db.prepare('SELECT COUNT(*) FROM paper_items WHERE paper_id=?').pluck().get(paper)).toBe(2);
  await page.reload();
  await expect(page.locator('.printable-paper')).not.toContainText('链路题目3');
  await page.goto(`/papers/${paper}/preview`);
  await expect(page.getByRole('link', { name: '继续编辑' })).toBeVisible();
  await expect(page.locator('.printable-paper')).toContainText('链路题目1');
  const deleted = await request.delete(`/api/papers/${paper}`); expect(deleted.ok()).toBe(true);
  expect(db.prepare('SELECT COUNT(*) FROM questions WHERE document_id=?').pluck().get(doc)).toBe(3);
  expect(errors).toEqual([]); db.close();
});
