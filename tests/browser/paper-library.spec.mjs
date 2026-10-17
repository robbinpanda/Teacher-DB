import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';

test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'paper-library-browser' } });
// Match the high-school fixtures for both SSR and API requests.
test.use({ storageState: { cookies: [{ name: 'teacher-db-scope', value: encodeURIComponent(JSON.stringify({subject:'数学',stage:'high'})), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });

test('两类试卷统一管理，恢复编排不会加入其他题目，保存更新同一作品', async ({ page, request }) => {
  test.setTimeout(90000);
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
  await page.setViewportSize({ width: 1366, height: 440 });
  await page.getByLabel('组卷链路测试 操作').click();
  const menu = page.locator('.asset-menu[open] > div');
  await expect(menu.getByRole('button', { name: '删除组卷作品' })).toBeInViewport();
  const bounds = await menu.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(440);
  await page.keyboard.press('Escape');
  await expect(page.locator('.asset-menu[open]')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  let release, captured;
  const held = new Promise(resolve => { release = resolve; });
  const received = new Promise(resolve => { captured = resolve; });
  await page.route('**/api/papers', async route => {
    const result = await route.fetch(); captured(); await held;
    await route.fulfill({ response: result });
  });
  await page.getByRole('button', { name: '保存试卷', exact: true }).click();
  await received;
  await page.locator('input[value="组卷链路测试"]').fill('保存中新增的修改');
  release();
  await expect(page.locator('.paper-save-state')).toContainText('有未保存修改');
  await expect(page.getByRole('button', { name: '下载试卷', exact: true })).toBeDisabled();
  await page.unroute('**/api/papers');
  await page.getByRole('button', { name: '保存试卷', exact: true }).click();
  await expect(page.locator('.paper-save-state')).toContainText('已保存');
  expect(db.prepare('SELECT title FROM papers WHERE id=?').pluck().get(paper)).toBe('保存中新增的修改');
  await page.goto(`/papers/${paper}/preview`);
  await expect(page.getByRole('link', { name: '继续编辑' })).toBeVisible();
  await expect(page.locator('.printable-paper')).toContainText('链路题目1');
  for (const suffix of ['', '?answers=1']) {
    const pdf = await request.get(`/api/papers/${paper}/pdf${suffix}`);
    expect(pdf.status(), await pdf.text().then(text => text.slice(0, 150))).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  }
  const deleted = await request.delete(`/api/papers/${paper}`); expect(deleted.ok()).toBe(true);
  expect(db.prepare('SELECT COUNT(*) FROM questions WHERE document_id=?').pluck().get(doc)).toBe(3);
  expect(errors).toEqual([]); db.close();
});
