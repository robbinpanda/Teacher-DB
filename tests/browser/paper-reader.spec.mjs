import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'paper-reader-browser' } });

test('原卷直接阅读 LaTeX 试卷，简答题两题一页且长题留白充足', async ({ page, request }) => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, 'teacher-question-bank.sqlite3'));
  const stamp = new Date().toISOString(), doc = crypto.randomUUID();
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES (?,'paper-reader-browser','排版阅读测试','application/pdf','complete','数学','高三',?,?)").run(doc, stamp, stamp);
  const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
  ids.forEach((id, i) => db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,status,needs_human_review,page_number,bbox_json,created_at,updated_at) VALUES (?,?,?,?,?,'参考答案','解析内容','approved',0,1,'{}',?,?)")
    .run(id, doc, String(i + 10), i === 0 ? 'fill' : 'answer', i === 5 ? Array.from({ length: 13 }, (_, n) => `（${n + 1}）已知函数 $f(x)=x^2$，请说明推导过程。`).join('\n') : `已知 $\\frac{x}{2}=3$，求 $x$。`, stamp, stamp));
  db.prepare("INSERT INTO question_assets (id,question_id,kind,role,label,crop_key,bbox_json,created_at) VALUES (?,?,'figure','question','三角形','reader-diagram.svg','{}',?)").run(crypto.randomUUID(), ids[1], stamp);
  await page.route('**/api/files/reader-diagram.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><path d="M10 70 L80 10 L150 70 Z" fill="none" stroke="black"/></svg>' }));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/papers');
  await page.getByRole('link', { name: '排版阅读测试', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/papers/uploaded/${doc}$`));
  const paper = page.locator('.printable-paper');
  await expect(paper).toHaveAttribute('data-pagination-ready', 'true');
  await expect(paper.locator('.katex').first()).toBeVisible();
  await expect(paper.locator('img')).toHaveCount(1);
  await expect.poll(() => paper.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.review-workspace')).toHaveCount(0);
  await expect(paper.locator('.paper-question-line > b')).toHaveText(['10.', '11.', '12.', '13.', '14.', '15.']);
  const checkLayout = async (counts = [1, 2, 1, 1]) => {
    const geometry = await paper.locator('.paper-paginated').evaluateAll(pages => pages.map(sheet => ({
      height: sheet.getBoundingClientRect().height,
      questions: Array.from(sheet.querySelectorAll('.paper-answer-question')).map(question => ({
        content: question.querySelector('.paper-question-content')?.getBoundingClientRect().height ?? 0,
        blank: question.querySelector('.answer-space').getBoundingClientRect().height,
        height: question.getBoundingClientRect().height,
      })),
    })));
    expect(geometry.map(sheet => sheet.questions.length)).toEqual(counts);
    for (const sheet of geometry) for (const question of sheet.questions) {
      expect(question.blank + 1).toBeGreaterThanOrEqual(question.content);
      expect(question.height).toBeGreaterThanOrEqual((sheet.height - 170) / 2);
    }
    expect(geometry.every(sheet => sheet.height < 1124)).toBe(true);
  };
  await checkLayout();
  await expect(paper.locator('.paper-paginated').first().locator('.paper-question-line > b')).toHaveText(['10.', '11.']);
  await page.screenshot({ path: 'tmp/paper-reader.png', fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await checkLayout();
  const loadingTask = getDocument({ data: new Uint8Array(await page.pdf({ preferCSSPageSize: true })) });
  const pdf = await loadingTask.promise;
  expect(pdf.numPages).toBe(4);
  for (let number = 1; number <= pdf.numPages; number++) {
    const pdfPage = await pdf.getPage(number);
    const content = (await pdfPage.getTextContent()).items.map(item => item.str).join('');
    expect(content).toContain(`第 ${number} 页`);
    expect(content).not.toContain('返回试卷库');
    if (number === 1) expect(content).toContain('11.');
  }
  await loadingTask.destroy();
  await page.emulateMedia({ media: 'screen' });
  const assembledId = crypto.randomUUID();
  const saved = await request.post('/api/papers', { data: {
    id: assembledId, title: '双栏剩余空间测试', questionIds: [ids[0], ids[2], ids[3]],
    settings: { notice: '', infoFields: [], style: { columns: 2 }, sections: [
      { id: 'fill', title: '填空题', questionIds: [ids[0]], acceptedTypes: ['fill'], defaultScore: 0 },
      { id: 'answer', title: '解答题', questionIds: [ids[2], ids[3]], acceptedTypes: ['answer'], defaultScore: 0 },
    ] },
  } });
  expect(saved.status()).toBe(201);
  await page.goto(`/papers/${assembledId}/preview`);
  const firstSheet = paper.locator('.paper-paginated').first();
  await expect(firstSheet.locator('.paper-page-answers .paper-question-line')).toHaveCount(1);
  const objectiveBounds = await firstSheet.locator('.paper-page-columns .paper-question').boundingBox();
  const answerBounds = await firstSheet.locator('.paper-page-answers .paper-question').boundingBox();
  expect(answerBounds.width).toBeGreaterThan(objectiveBounds.width * 1.9);
  expect(answerBounds.y).toBeGreaterThanOrEqual(objectiveBounds.y + objectiveBounds.height);
  await expect(paper.locator('.paper-paginated')).toHaveCount(2);
  await request.delete(`/api/papers/${assembledId}`);
  await page.goto(`/papers/uploaded/${doc}`);
  await page.getByRole('link', { name: '查看答案解析' }).click();
  await expect(paper.locator('.printable-answer')).toHaveCount(6);
  await expect(paper.locator('.answer-space')).toHaveCount(0);
  const unauthorized = await request.get(`/papers/uploaded/${doc}`, { headers: { 'oai-authenticated-user-id': 'another-teacher' } });
  expect(unauthorized.status()).toBe(404);
  db.prepare('UPDATE documents SET source_removed_at=? WHERE id=?').run(stamp, doc);
  await page.goto(`/papers/uploaded/${doc}`);
  await expect(paper.locator('.paper-question-line')).toHaveCount(6);
  db.prepare('UPDATE questions SET stem=? WHERE id=?').run(Array.from({ length: 15 }, () => '选择填空题内容占用页面空间。').join('\n'), ids[0]);
  await page.reload();
  await expect(paper).toHaveAttribute('data-pagination-ready', 'true');
  await checkLayout([0, 2, 2, 1]);
  db.prepare('DELETE FROM questions WHERE document_id=?').run(doc);
  db.prepare("UPDATE documents SET status='extracting' WHERE id=?").run(doc);
  await page.reload();
  await expect(page.getByRole('heading', { name: '试卷正在处理中' })).toBeVisible();
  expect(errors).toEqual([]);
  db.close();
});
