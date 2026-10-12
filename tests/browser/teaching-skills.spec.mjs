import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'skills-browser' } });

test('Skills 首页隐藏规则，方案可搜索、编辑并恢复，创建流程不伪造验证', async ({ page }) => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, 'teacher-question-bank.sqlite3'));
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  const content = '---\nname: sample-skill\ndescription: 样例识别方案\n---\n# 识别规则\n逐字转录试卷题号和选项。\n遇到图片不完整时标记人工复核。\n不得补写原卷中没有的答案。';
  db.prepare("INSERT INTO teaching_skills (id,owner_id,subject,grade,name,content,created_at,updated_at) VALUES (?,'skills-browser','数学','九年级','数学模拟卷识别',?,?,?)").run(id, content, stamp, stamp);
  await page.goto('/settings/skills');
  await expect(page.getByRole('button', { name: '查看与编辑' })).toBeVisible();
  await expect(page.locator('.skill-compare')).toHaveCount(0);
  for (const width of [1366,1440,1680,1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440) await page.screenshot({ path: 'tmp/skills-1440.png', fullPage: true });
  }
  await page.getByLabel('搜索识别方案').fill('没有的名称');
  await expect(page.getByText('没有匹配的方案，请调整搜索。')).toBeVisible();
  await page.getByLabel('搜索识别方案').fill('');
  await page.getByRole('button', { name: '查看与编辑' }).click();
  await expect(page.getByText('规则摘要', { exact: true })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
  await page.getByRole('tab', { name: '高级规则' }).click();
  await page.locator('.skill-field input').fill('已调整的方案');
  await page.getByRole('button', { name: '保存新版本' }).click();
  await expect(page.getByText('已保存新版本，需要重新试识别与人工复核。')).toBeVisible();
  expect(db.prepare('SELECT name FROM teaching_skills WHERE id=?').pluck().get(id)).toBe('已调整的方案');
  await page.getByRole('button', { name: '返回我的识别方案' }).click();
  await page.reload();
  await expect(page.getByText('已调整的方案', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ 创建 Skill' }).click();
  await expect(page.getByLabel('上传试卷样例图片')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成个人草稿' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  db.close();
});
