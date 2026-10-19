import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';

const owner = 'question-discovery-browser';
test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': owner } });

test('真实选题：知识点和来源筛选、独立批量选择、持久篮子、排序及保存作品', async ({ page }) => {
  test.setTimeout(90000);
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, 'teacher-question-bank.sqlite3'));
  const stamp = new Date().toISOString(), ids = [], tag = crypto.randomUUID();
  db.prepare('INSERT INTO tags (id,name,created_at) VALUES (?,?,?)').run(tag, '二次函数', stamp);
  for (let i = 0; i < 3; i++) {
    const doc = crypto.randomUUID(), id = crypto.randomUUID(); ids.push(id);
    db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,subject,grade,source_year,source_region,source_school,source_exam_type,created_at,updated_at) VALUES (?,?,?,'application/pdf','complete','数学','九年级',?,'上海','示例中学','期末',?,?)").run(doc, owner, `选题验收来源 ${i + 1}`, String(2023 + i), stamp, stamp);
    db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,status,needs_human_review,page_number,bbox_json,created_at,updated_at) VALUES (?,?,'1','fill',?,'2','利用二次函数求解','approved',0,1,'{}',?,?)").run(id, doc, `独立选题 ${i + 1}：已知二次函数 $y=x^2-2x+1$，求函数最小值。\n$$y=(x-1)^2$$\n写出完整的推导过程，并说明等号成立的条件。`, stamp, stamp);
    if (i < 2) db.prepare('INSERT INTO question_tags (question_id,tag_id) VALUES (?,?)').run(id, tag);
  }
  await page.goto('/bank');
  const cards = page.locator('.question-card'), bulk = page.getByRole('region', {name:'题目批量操作'});
  const card = n => cards.filter({hasText:`独立选题 ${n}：`});
  const trigger = n => page.getByRole('button', {name:`打开选题篮，${n} 道题`});
  await expect(cards).toHaveCount(3);
  await card(1).getByRole('button', {name:'加入选题篮',exact:true}).click();
  await expect(trigger(1)).toBeVisible();
  await expect(bulk).toHaveCount(0);
  await card(2).getByRole('checkbox').check();
  await expect(trigger(1)).toBeVisible();
  await expect(bulk).toContainText('已选 1 道题');
  await bulk.getByRole('button', {name:'批量加入选题篮'}).click();
  await expect(trigger(2)).toBeVisible();
  await expect(bulk).toHaveCount(0);
  await page.getByLabel('全选当前页题目').check();
  // Adding two existing IDs and one new ID must deduplicate without changing order.
  await bulk.getByRole('button', {name:'批量加入选题篮'}).click();
  await expect(trigger(3)).toBeVisible();
  await card(3).getByRole('button', {name:'移出选题篮'}).click();
  await expect(trigger(2)).toBeVisible();
  await page.getByRole('navigation', {name:'题目知识点'}).getByRole('button', {name:'二次函数',exact:true}).click();
  await expect(cards).toHaveCount(2);
  await expect(trigger(2)).toBeVisible();
  await card(1).getByRole('checkbox').check();
  await page.getByLabel('筛选知识点').fill('二次');
  await expect(bulk).toContainText('已选 1 道题');
  for (const width of [1440,1920,390]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:`tmp/discovery-filter-selection-${width}.png`,animations:'disabled'});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await trigger(2).click();
    await expect(page.getByRole('dialog', {name:'选题篮 · 2 道题'})).toBeVisible();
    await page.screenshot({path:`tmp/discovery-basket-${width}.png`,animations:'disabled'});
    await page.keyboard.press('Escape');
    await expect(trigger(2)).toBeFocused();
  }
  await page.locator('.bank-more-filters summary').click();
  await page.getByLabel('筛选年份').selectOption('2025');
  await expect(page.getByRole('heading', {name:'没有匹配的题目'})).toBeVisible();
  await expect(bulk).toHaveCount(0);
  await expect(trigger(2)).toBeVisible();
  await page.locator('.bank-more-filters summary').click();
  for (const width of [1440,1920]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:`tmp/discovery-empty-${width}.png`,animations:'disabled'});
  }
  await page.getByRole('button', {name:'清除筛选',exact:true}).click();
  await expect(cards).toHaveCount(3);
  await page.locator('.bank-more-filters summary').click();
  await page.getByLabel('筛选年份').selectOption('2025');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('独立选题 3');
  await page.goto('/papers');
  await page.goto('/bank');
  await expect(trigger(2)).toBeVisible();
  await page.reload();
  await expect(trigger(2)).toBeVisible();
  await page.locator('.scope-trigger').click();
  await page.locator('.subject-trigger').click();
  await page.getByRole('option', {name:'英语',exact:true}).click();
  await expect(trigger(0)).toBeVisible();
  await page.locator('.scope-trigger').click();
  await page.locator('.subject-trigger').click();
  await page.getByRole('option', {name:'数学',exact:true}).click();
  await expect(trigger(2)).toBeVisible();
  await trigger(2).click();
  const basket = page.getByRole('dialog', {name:'选题篮 · 2 道题'});
  await basket.getByRole('button', {name:'上移第 2 题'}).click();
  const href = await basket.getByRole('link', {name:'进入组卷'}).getAttribute('href');
  expect(new URL(href,'http://local').searchParams.get('ids').split(',')).toEqual([ids[1],ids[0]]);
  await basket.getByRole('link', {name:'进入组卷'}).click();
  await expect(page.locator('.printable-paper .paper-question')).toHaveCount(2);
  await page.getByRole('button', {name:'保存试卷',exact:true}).click();
  await expect(page).toHaveURL(/\/papers\/[a-z0-9-]+$/);
  const paperId = page.url().split('/').pop();
  expect(db.prepare('SELECT question_id FROM paper_items WHERE paper_id=? ORDER BY position').all(paperId).map(row=>row.question_id)).toEqual([ids[1],ids[0]]);
  await page.reload();
  await expect(page.locator('.printable-paper .paper-question')).toHaveCount(2);
  // Restoration validates real backend availability, not cached question bodies.
  db.prepare("UPDATE questions SET status='pending' WHERE id=?").run(ids[0]);
  await page.goto('/bank');
  await expect(trigger(1)).toBeVisible();
  await expect(page.getByText('已移除 1 道已删除或不可用的题目', {exact:true})).toBeVisible();
  await trigger(1).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', {name:'清空选题篮',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('选题篮 · 1 道题');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name:'清空选题篮',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('还没有选题');
  expect(db.prepare('SELECT COUNT(*) FROM questions WHERE id IN (?,?,?)').pluck().get(...ids)).toBe(3);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('jianti-question-basket:'));
    localStorage.setItem(key, '{broken');
  });
  await page.reload();
  await expect(page.locator('.bank-basket-message')).toContainText('本机选题篮数据无法读取');
  await trigger(0).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name:'清空选题篮',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('还没有选题');
  db.close();
});
