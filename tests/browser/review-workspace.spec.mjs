import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

async function fixture(withImages = false) {
  const root = process.env.JIANTI_E2E_DATA_DIR;
  const db = new Database(path.join(root, 'teacher-question-bank.sqlite3'));
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,created_at,updated_at) VALUES (?,'local-demo','2026年上海市高中数学二模试卷（含答案与解析）.pdf','application/pdf','reviewing',2,'数学',?,?)").run(id, now, now);
  await fs.mkdir(path.join(root, 'files', 'documents', id), { recursive: true });
  const box = { x: 10, y: 12, width: 80, height: 32 };
  const pageIds = [];
  for (let page = 1; page <= 2; page++) {
    const pageId = crypto.randomUUID(), key = `documents/${id}/page-${page}.png`;
    pageIds.push(pageId);
    const rows = Array.from({ length: 5 }, (_, index) => `<text x="60" y="${120 + index * 175}" font-size="20">${index + 1 + (page - 1) * 5}. 已知函数 f(x) = x² − 2x，求函数的最小值。</text><text x="85" y="${175 + index * 175}" font-size="18">解：由 f(x) = (x − 1)² − 1，得最小值为 −1。</text><text x="85" y="${215 + index * 175}" font-size="18" fill="#666">当 x = 1 时等号成立。</text>`).join('');
    await fs.writeFile(path.join(root, 'files', key), await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120"><rect width="800" height="1120" fill="white"/><g font-family="Microsoft YaHei" fill="#222"><text x="175" y="55" font-size="25">高中数学 · 参考答案与解析</text>${rows}</g><path d="M680 930L620 1050H750Z M680 930V1050" stroke="#333" stroke-width="2" fill="none"/></svg>`)).png().toBuffer());
    db.prepare('INSERT INTO pages (id,document_id,page_number,storage_key,width,height,created_at) VALUES (?,?,?,?,800,1120,?)').run(pageId, id, page, key, now);
    db.prepare("INSERT INTO extraction_runs (id,document_id,page_id,page_number,provider,model,status,created_at,finished_at) VALUES (?,?,?,?,'openai-chat-completions','fixture','complete',?,?)").run(crypto.randomUUID(), id, pageId, page, now, now);
  }
  const questionIds = [];
  for (let number = 1; number <= 21; number++) {
    const q = crypto.randomUUID(); questionIds.push(q);
    db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,page_number,bbox_json,confidence,needs_human_review,created_at,updated_at) VALUES (?,?,?,'fill',?,'$-1$',?,?,?,0.95,0,?,?)").run(q, id, String(number), `已知函数 $f(x)=x^2-2x$，求函数的最小值。第 ${number} 题`, '由 $f(x)=(x-1)^2-1$，当 $x=1$ 时取得最小值 $-1$。', number > 10 ? 2 : 1, JSON.stringify(box), now, now);
  }
  if (withImages) {
    for (const role of ['question', 'answer']) {
      const key = `documents/${id}/page-1.png`;
      db.prepare('INSERT INTO question_assets (id,question_id,page_id,kind,role,label,source_key,crop_key,bbox_json,position,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), questionIds[0], pageIds[0], 'figure', role, role === 'question' ? '题图' : '答案图', key, key, JSON.stringify({ x: 76, y: 82, width: 19, height: 13 }), role === 'question' ? 0 : 1, now);
    }
  }
  return { id, questionIds, db, close: () => db.close() };
}

test('审核工作台：三个桌面尺寸保持主次和固定操作，窄屏不溢出', async ({ page }, testInfo) => {
  const f = await fixture(true);
  try {
    await page.goto(`/review/${f.id}`);
    await expect.poll(() => page.getByAltText('原试卷第 1 页').evaluate(img => img.naturalWidth)).toBe(800);
    const correction = page.locator('details').filter({ has: page.locator('summary', { hasText: '图片修正' }) }).first();
    await expect(correction).not.toHaveAttribute('open');
    const sourceImage = await page.getByAltText('原试卷第 1 页').boundingBox();
    const stage = await page.locator('.page-stage').boundingBox();
    expect(sourceImage.y).toBeGreaterThanOrEqual(stage.y);
    const initialWidth = sourceImage.width;
    await page.getByRole('button', { name: '放大原卷' }).click();
    await expect.poll(async () => (await page.getByAltText('原试卷第 1 页').boundingBox()).width).toBeGreaterThan(initialWidth);
    await page.getByRole('button', { name: '缩小原卷' }).click();
    await expect(page.getByRole('button', { name: 'AI 复核本题图片' })).toBeHidden();
    await page.locator('.question-asset-gallery button').first().click();
    await expect(correction).toHaveAttribute('open');
    await page.getByText('图片修正', { exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑题图 1', exact: true })).toBeAttached();
    await page.locator('.editor-scroll').evaluate(el => { el.scrollTop = 0; });
    for (const width of [1440, 1680, 1920, 1024, 800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole('button', { name: '确认入库', exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width >= 1024) {
        const source = await page.locator('.source-panel').boundingBox();
        const editor = await page.locator('.editor-panel').boundingBox();
        expect(source.width).toBeGreaterThan(editor.width);
        const footer = await page.locator('.review-editor-footer').boundingBox();
        await page.getByText('图片修正', { exact: true }).click();
        await page.locator('.editor-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
        expect((await page.locator('.review-editor-footer').boundingBox()).y).toBe(footer.y);
        await page.getByText('图片修正', { exact: true }).click();
        await page.locator('.editor-scroll').evaluate(el => { el.scrollTop = 0; });
      }
      if (width >= 1440 || width === 390) await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`) });
    }
  } finally { f.close(); }
});

test('保存草稿与入库分离；切题保留修改；无图题可以补图、裁剪、删除和手工框选', async ({ page }) => {
  const f = await fixture(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/review/${f.id}`);
    await expect.poll(() => page.getByAltText('原试卷第 1 页').evaluate(img => img.naturalWidth)).toBe(800);
    await page.getByRole('button', { name: '编辑题干 LaTeX', exact: true }).click();
    await page.getByRole('textbox', { name: '题干 LaTeX', exact: true }).fill('修正后的题干 $x^2$');
    await page.getByRole('button', { name: '下一题', exact: true }).click();
    await page.getByRole('button', { name: '上一题', exact: true }).click();
    await page.getByRole('button', { name: '编辑题干 LaTeX', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '题干 LaTeX', exact: true })).toHaveValue('修正后的题干 $x^2$');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.review-save-state')).toHaveText('修改已保存');
    expect(f.db.prepare('SELECT status FROM questions WHERE id=?').pluck().get(f.questionIds[0])).toBe('pending');
    await page.getByText('图片修正', { exact: true }).click();
    await page.getByRole('button', { name: '新增答案图', exact: true }).click();
    await expect(page.locator('.bbox-grid')).toBeHidden();
    await page.getByText('高级裁剪参数', { exact: true }).click();
    await page.locator('.bbox-grid').getByRole('spinbutton').first().fill('15');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.review-save-state')).toHaveText('修改已保存');
    const asset = f.db.prepare('SELECT bbox_json,role FROM question_assets WHERE question_id=?').get(f.questionIds[0]);
    expect(JSON.parse(asset.bbox_json).x).toBe(15); expect(asset.role).toBe('answer');
    await page.getByRole('button', { name: '删除此图', exact: true }).click();
    await page.getByRole('button', { name: '新增题图', exact: true }).click();
    await page.getByRole('button', { name: '删除此图', exact: true }).click();
    await page.getByRole('button', { name: '框选第 1 页', exact: false }).click();
    await expect(page.locator('.region-edit-box')).toBeVisible();
    await expect(page.getByRole('button', { name: /重新识别|AI 复核本题图片/ })).toHaveCount(0);
    await page.getByRole('button', { name: '确认入库', exact: true }).click();
    await expect(page.locator('.review-save-state')).toHaveText('已保存，审核通过');
    expect(f.db.prepare('SELECT status FROM questions WHERE id=?').pluck().get(f.questionIds[0])).toBe('approved');
    await page.reload();
    await expect(page.getByRole('region', { name: '题干内容', exact: true })).toContainText('修正后的题干');
    expect(f.db.prepare('SELECT count(*) FROM question_regions WHERE question_id=?').pluck().get(f.questionIds[0])).toBe(1);
    expect(f.db.prepare('SELECT count(*) FROM question_assets WHERE question_id=?').pluck().get(f.questionIds[0])).toBe(0);
    await page.getByRole('button', { name: '自动入库', exact: true }).click();
    await expect(page.locator('.review-progress')).toContainText('21 / 21');
    expect(errors).toEqual([]);
  } finally { f.close(); }
});

test('默认显示公式，点击预览编辑 LaTeX，返回预览并保存原始文本', async ({ page }) => {
  const f = await fixture(true);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/review/${f.id}`);
    const stem = page.getByRole('region', { name: '题干内容', exact: true });
    const answer = page.getByRole('region', { name: '答案内容', exact: true });
    await expect(stem.locator('.katex')).toBeVisible();
    await expect(answer.locator('.katex')).toBeVisible();
    await expect(page.locator('.review-extraction textarea')).toHaveCount(0);
    // Clicking the content surface (rather than a separate edit toolbar) opens the source.
    await stem.locator('.review-content-preview').click();
    const input = page.getByRole('textbox', { name: '题干 LaTeX', exact: true });
    await expect(input).toBeFocused();
    const source = '计算 $\\frac{1}{2}+x^2$ 的值。';
    await input.fill(source);
    await page.getByRole('button', { name: '完成编辑', exact: true }).click();
    await expect(stem.locator('.katex .mfrac')).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect(page.getByRole('button', { name: '编辑题干 LaTeX', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '编辑答案 LaTeX', exact: true }).click();
    const answerInput = page.getByRole('textbox', { name: '答案 LaTeX', exact: true });
    await answerInput.fill('$\\sqrt{2}$');
    await answerInput.press('Control+Enter');
    await expect(answer.locator('.katex')).toBeVisible();
    await page.getByRole('button', { name: '编辑解析 LaTeX', exact: true }).click();
    await page.getByRole('button', { name: '插入答案图 1', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '解析 LaTeX', exact: true })).toHaveValue(/\[\[image:1\]\]/);
    await page.getByRole('button', { name: '完成编辑', exact: true }).click();
    await expect(page.getByRole('region', { name: '解析内容', exact: true }).locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.review-save-state')).toHaveText('修改已保存');
    expect(f.db.prepare('SELECT stem,answer,status FROM questions WHERE id=?').get(f.questionIds[0])).toEqual({ stem: source, answer: '$\\sqrt{2}$', status: 'pending' });
    await page.reload();
    await expect(stem.locator('.katex .mfrac')).toBeVisible();
    await expect(answer.locator('.katex')).toBeVisible();
    await expect(page.locator('.review-extraction textarea')).toHaveCount(0);
  } finally { f.close(); }
});

test('长题干答案解析各自滚动，知识标签常驻展开，手工图片修正入口始终可见', async ({ page }, testInfo) => {
  const f = await fixture(true);
  try {
    const longText = '一行校对内容 $x^2+1$。\n'.repeat(45);
    f.db.prepare('UPDATE questions SET stem=?,answer=?,analysis=? WHERE id=?').run(longText, longText, longText, f.questionIds[0]);
    await page.goto(`/review/${f.id}`);
    for (const height of [1000, 900, 768]) {
      await page.setViewportSize({ width: 1440, height });
      await expect(page.getByRole('region', { name: '知识标签', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#review-image-corrections > summary')).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('combobox', { name: '添加知识标签', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.review-knowledge-tags summary')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const label of ['题干', '答案', '解析']) {
      const preview = page.getByLabel(`${label}预览`, { exact: true });
      const sizes = await preview.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight, max: parseFloat(getComputedStyle(el).maxHeight) }));
      expect(sizes.content).toBeGreaterThan(sizes.height);
      expect(sizes.height).toBeLessThanOrEqual(sizes.max);
      await preview.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => preview.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.locator('.editor-scroll').evaluate(el => el.scrollTop)).toBe(0);
      await preview.click();
      await expect(page.getByRole('textbox', { name: `${label} LaTeX`, exact: true })).toBeFocused();
      await page.getByRole('button', { name: '完成编辑', exact: true }).click();
    }
    await page.screenshot({ path: testInfo.outputPath('compact-review-long-content.png') });
    await page.locator('#review-image-corrections > summary').click();
    await expect(page.getByRole('button', { name: /重新识别|AI 复核本题图片/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新增题图', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '知识标签', exact: true })).toBeInViewport({ ratio: 1 });
  } finally { f.close(); }
});

test('从指定题目进入正确原页，保存失败仍可修正并重试', async ({ page }) => {
  const f = await fixture();
  try {
    await page.goto(`/review/${f.id}?question=${f.questionIds[10]}`);
    await expect(page.locator('.source-location')).toContainText('2 / 2');
    await expect.poll(() => page.locator('.page-stage').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    await page.route(`**/api/questions/${f.questionIds[10]}`, route => route.fulfill({ status: 500, json: { error: '测试保存失败' } }));
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.review-editor-footer').getByRole('alert')).toContainText('测试保存失败');
    await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await page.unroute(`**/api/questions/${f.questionIds[10]}`);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.review-save-state')).toHaveText('修改已保存');
  } finally { f.close(); }
});
