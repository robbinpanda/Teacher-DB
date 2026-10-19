import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';

test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'education-scope-browser' } });

test('switching subjects and stages isolates all three libraries and survives reload', async ({ page }) => {
  test.setTimeout(90000);
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, 'teacher-question-bank.sqlite3'));
  const stamp = new Date().toISOString();
  const scopes = [
    { subject: '数学', stage: 'middle', label: '初中', grade: '九年级' },
    { subject: '英语', stage: 'middle', label: '初中', grade: '九年级' },
    { subject: '英语', stage: 'primary', label: '小学', grade: '六年级' },
  ];
  for (const [i, scope] of scopes.entries()) {
    const id = `scope-ui-${i}`;
    db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,grade,created_at,updated_at) VALUES (?,'education-scope-browser',?,'application/pdf','complete',0,?,?,?,?)").run(id, `${scope.label}${scope.subject}原卷`, scope.subject, scope.grade, stamp, stamp);
    db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,page_number,bbox_json,status,needs_human_review,created_at,updated_at) VALUES (?,?,1,'fill',?,'1',1,'{}','approved',0,?,?)").run(`${id}-q`, id, `${scope.label}${scope.subject}独立题目`, stamp, stamp);
    db.prepare("INSERT INTO papers (id,owner_id,title,settings_json,created_at,updated_at) VALUES (?,'education-scope-browser',?,?,?,?)").run(`${id}-paper`, `${scope.label}${scope.subject}组卷`, JSON.stringify(scope), stamp, stamp);
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function check(scope) {
    await expect(page.locator('.scope-trigger')).toContainText(`${scope.label} · ${scope.subject}`);
    await expect(page.locator('.wb-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.wb-table')).toContainText(`${scope.label}${scope.subject}原卷`);
    await page.getByRole('button', {name:'导入试卷',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'导入试卷'});
    await expect(dialog.getByRole('region',{name:'目标题库'})).toContainText(`${scope.label} · ${scope.subject}`);
    await expect(dialog.getByLabel('学段',{exact:true})).toHaveCount(0);
    await expect(dialog.getByLabel('学科',{exact:true})).toHaveCount(0);
    await expect(dialog.getByLabel('年级',{exact:true})).toHaveValue(scope.grade);
    await dialog.getByRole('button',{name:'关闭导入',exact:true}).click();
    await page.getByRole('link', { name: '题库', exact: true }).click();
    await expect(page.locator('.question-card')).toHaveCount(1);
    await expect(page.locator('.question-card')).toContainText(`${scope.label}${scope.subject}独立题目`);
    await page.getByRole('link', { name: '试卷库', exact: true }).click();
    await expect(page.locator('.asset-table tbody tr')).toHaveCount(2);
    await expect(page.locator('.asset-table')).toContainText(`${scope.label}${scope.subject}原卷`);
    await expect(page.locator('.asset-table')).toContainText(`${scope.label}${scope.subject}组卷`);
    await page.getByRole('link', { name: '工作台', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3189/');
    await expect(page.locator('.wb-table tbody tr')).toHaveCount(1);
  }
  try {
    await page.goto('/');
    await check(scopes[0]);
    await page.locator('.scope-trigger').click();
    await page.locator('.subject-trigger').click();
    await page.getByRole('option', {name:'英语',exact:true}).click();
    await check(scopes[1]);
    if (!(await page.locator('.stage-switch').isVisible())) await page.locator('.scope-trigger').click();
    await page.locator('.stage-switch').getByRole('button',{name:'小学',exact:true}).click();
    await check(scopes[2]);
    await page.reload();
    await check(scopes[2]);
    await page.getByRole('link', {name:'题库',exact:true}).click();
    await page.locator('.scope-trigger').click();
    await page.locator('.subject-trigger').click();
    await page.getByRole('option',{name:'数学',exact:true}).click();
    await expect(page.locator('.scope-trigger')).toContainText('小学 · 数学');
    await expect(page.locator('.question-card')).toHaveCount(0);
    await page.locator('.scope-trigger').click();
    await page.locator('.stage-switch').getByRole('button',{name:'初中',exact:true}).click();
    await expect(page.locator('.question-card')).toHaveCount(1);
    await expect(page.locator('.question-card')).toContainText('初中数学独立题目');
    await page.screenshot({path:'tmp/education-scope-browser.png',fullPage:true});
    expect(errors).toEqual([]);
  } finally { db.close(); }
});

test('import request retains the displayed destination when another tab changes the scope cookie', async ({page,context}) => {
  await context.addCookies([{name:'teacher-db-scope',value:encodeURIComponent(JSON.stringify({subject:'英语',stage:'primary'})),url:'http://127.0.0.1:3189'}]);
  await page.goto('/');
  await page.getByRole('button',{name:'导入试卷',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'导入试卷'});
  await expect(dialog.getByRole('region',{name:'目标题库'})).toContainText('小学 · 英语');
  await expect(dialog.getByLabel('年级',{exact:true}).locator('option')).toHaveText(['一年级','二年级','三年级','四年级','五年级','六年级']);
  await dialog.getByLabel('年级',{exact:true}).selectOption('三年级');
  await dialog.getByLabel('选择 PDF 文件').setInputFiles({name:'scope-target.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});
  await context.addCookies([{name:'teacher-db-scope',value:encodeURIComponent(JSON.stringify({subject:'数学',stage:'high'})),url:'http://127.0.0.1:3189'}]);
  let destination;
  await page.route(/\/api\/documents(?:\?.*)?$/,async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const incoming = route.request();
    const form = await new Request(incoming.url(),{method:'POST',headers:incoming.headers(),body:incoming.postDataBuffer()}).formData();
    destination = {subject:new URL(incoming.url()).searchParams.get('subject'),stage:new URL(incoming.url()).searchParams.get('stage'),grade:form.get('grade'),formSubject:form.get('subject')};
    await route.fulfill({json:{id:'target-fixture',status:'complete',pageCount:1,originalKey:'fixture.pdf',duplicate:true}});
  });
  await dialog.getByRole('button',{name:'开始导入',exact:true}).click();
  await expect.poll(()=>destination).toEqual({subject:'英语',stage:'primary',grade:'三年级',formSubject:'英语'});

});
