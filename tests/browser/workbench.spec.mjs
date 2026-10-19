import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

test.use({ extraHTTPHeaders: { "oai-authenticated-user-id": "workbench-browser" } });
// Match the high-school fixtures for both SSR and API requests.
test.use({ storageState: { cookies: [{ name: 'teacher-db-scope', value: encodeURIComponent(JSON.stringify({subject:'数学',stage:'high'})), domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });


function papers() {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"));
  db.pragma("foreign_keys = ON");
  const items = [];
  for (let index = 0; index < 10; index++) {
    const id = crypto.randomUUID(), pageId = crypto.randomUUID();
    const createdAt = new Date(Date.UTC(2026, 8, 10 + index, 6, 30)).toISOString();
    const status = index < 7 ? "reviewing" : index < 9 ? "complete" : "failed";
    const name = `工作台验收-${String(index + 1).padStart(2, "0")}-上海市${["浦东新区", "闵行区", "虹口区"][index % 3]}高三数学二模试卷（含答案及完整解析）.pdf`;
    db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,grade,created_at,updated_at) VALUES (?,'workbench-browser',?,'application/pdf',?,1,'数学','高三',?,?)").run(id, name, status, createdAt, createdAt);
    if (status !== "failed") {
      db.prepare("INSERT INTO pages (id,document_id,page_number,storage_key,width,height,created_at) VALUES (?,?,1,'fixture.png',600,800,?)").run(pageId, id, createdAt);
      db.prepare("INSERT INTO extraction_runs (id,document_id,page_id,page_number,provider,model,status,created_at,finished_at) VALUES (?,?,?,1,'openai-chat-completions','测试模型','complete',?,?)").run(crypto.randomUUID(), id, pageId, createdAt, createdAt);
      for (let q = 0; q < 4; q++) db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,page_number,bbox_json,confidence,needs_human_review,status,created_at,updated_at) VALUES (?,?,?,'fill','测试题干','1','测试解析',1,'{}',0.95,0,?,?,?)").run(crypto.randomUUID(), id, String(q + 1), status === "complete" || q === 0 ? "approved" : "pending", createdAt, createdAt);
    }
    items.push({ id, name, status });
  }
  return { db, items, close() { for (const item of items) db.prepare("DELETE FROM documents WHERE id=?").run(item.id); db.close(); } };
}

test("空库引导与常见笔记本尺寸下的导入首屏", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "oai-authenticated-user-id": "ui-empty-library" });
  await page.route("**/api/model-profiles", route => route.fulfill({ json: {
    profiles: [{ id: "ready", displayName: "已配置的识别模型", model: "fixture", apiKeyMask: "configured" }], selectedProfileId: "ready",
  } }));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "把手里的试卷，变成自己的题库" })).toBeVisible();
    await expect(page.getByRole("region", { name: "工作概况" })).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "搜索试卷名称" })).toHaveCount(0);
    await expect(page.getByRole("form", { name: "试卷分页" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `tmp/ui-welcome-${width}.png`, fullPage: true });
    const trigger = page.getByRole("button", { name: "导入第一份试卷" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "导入试卷" });
    await expect(dialog.getByLabel("选择识别模型")).toHaveValue("ready");
    await expect(dialog.getByLabel("同时处理试卷数")).not.toBeVisible();
    if (width === 1280) {
      for (const locator of [dialog.getByLabel("年级", { exact: true }), dialog.getByLabel("选择识别模型"), dialog.locator(".wb-drop-zone")]) {
        const box = await locator.boundingBox();
        const footer = await dialog.locator(".wb-dialog-footer").boundingBox();
        expect(box.y).toBeGreaterThan(0);
        expect(box.y + box.height).toBeLessThanOrEqual(footer.y);
      }
    }
    await page.screenshot({ path: `tmp/ui-import-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
});

test("桌面表格布局、统计筛选、搜索排序与手机局部滚动", async ({ page }) => {
  const fixture = papers();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    for (const width of [1440, 1536, 1920, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/");
      await page.getByRole("tab", { name: /^全部/ }).click();
      await page.getByRole("searchbox", { name: "搜索试卷名称" }).fill("工作台验收");
      await expect(page.locator(".wb-table tbody tr")).toHaveCount(10);
      const geometry = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        return { scroll: document.documentElement.scrollWidth, header: rect(".wb-header"), stats: rect(".wb-overview"), table: rect(".wb-library"), sidebar: rect(".sidebar"), row: rect(".wb-table tbody tr"), tableScroll: document.querySelector(".wb-table-scroll").scrollWidth, tableWidth: document.querySelector(".wb-table-scroll").clientWidth };
      });
      expect(geometry.scroll).toBeLessThanOrEqual(width);
      expect(geometry.stats.y).toBeGreaterThan(geometry.header.y + geometry.header.height);
      expect(geometry.table.y).toBeGreaterThan(geometry.stats.y + geometry.stats.height);
      expect(geometry.row.height).toBeGreaterThanOrEqual(64);
      expect(geometry.row.height).toBeLessThanOrEqual(72);
      if (width > 900) {
        expect(geometry.sidebar.width).toBe(216);
        expect(geometry.tableScroll).toBe(geometry.tableWidth);
      }
      await expect(page.locator(".wb-table th")).toHaveText(["试卷名称", "年级 / 学科", "题目数量", "审核进度", "上传时间", "操作"]);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.screenshot({ path: `tmp/workbench-refactor-${width}.png`, fullPage: true });
      if (width === 390) {
        await page.getByRole("button", { name: "展开导航" }).click();
        await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "识题规则" })).toBeVisible();
        await page.getByRole("button", { name: "收起导航" }).click();
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: /待审核 .*道题，查看对应试卷/ }).click();
    await expect(page.getByRole("tab", { name: /^待审核/ })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("searchbox").fill("工作台验收-03");
    await expect(page.locator(".wb-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".wb-row-actions").getByRole("link", { name: "审核", exact: true })).toHaveAttribute("href", `/review/${fixture.items[2].id}`);
    await page.getByRole("searchbox").fill("不存在的试卷");
    await expect(page.getByText("没有匹配的试卷", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除搜索" }).click();
    await page.getByRole("tab", { name: /^全部/ }).click();
    await page.getByRole("searchbox").fill("工作台验收");
    await page.getByLabel("试卷排序").selectOption("oldest");
    await expect(page.locator(".document-main strong").first()).toHaveText(fixture.items[0].name);
    await page.getByLabel("试卷排序").selectOption("newest");
    await expect(page.locator(".document-main strong").first()).toHaveText(fixture.items[9].name);
    await page.getByRole("button", { name: "批量操作" }).click();
    await page.getByLabel(`选择 ${fixture.items[9].name}`).check();
    await page.getByRole("tab", { name: /^已入库/ }).click();
    await expect(page.locator(".document-selector")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { fixture.close(); }
});

test("导入抽屉保留配置、文件暂存校验、拖放和焦点恢复", async ({ page }) => {
  let selected = "one";
  const profiles = [{ id: "one", displayName: "测试模型一", model: "one", apiKeyMask: null }, { id: "two", displayName: "测试模型二", model: "two", apiKeyMask: null }];
  await page.route("**/api/model-profiles", async route => {
    if (route.request().method() === "PATCH") selected = route.request().postDataJSON().selectedProfileId;
    await route.fulfill({ json: { profiles, selectedProfileId: selected } });
  });
  let posts = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/documents" && request.method() === "POST") posts++; });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "导入试卷", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "导入试卷" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", { name: "目标题库" })).toContainText("高中 · 数学");
  await expect(dialog.getByLabel("学科", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("年级", { exact: true }).selectOption("高二");
  await dialog.getByLabel("选择识别模型").selectOption("two");
  await expect.poll(() => selected).toBe("two");
  await expect(dialog.getByText(/当前模型尚未配置 API Key/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "管理模型" })).toHaveAttribute("href", "/settings/models");
  await dialog.locator(".wb-import-advanced summary").click();
  await expect(dialog.getByRole("link", { name: "查看与定制" })).toHaveAttribute("href", "/settings/skills");
  await dialog.getByLabel("同时处理试卷数").fill("0");
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(dialog.getByText("请输入 1–100 的整数")).toBeVisible();
  await dialog.getByLabel("同时处理试卷数").fill("3");
  await dialog.getByRole("button", { name: "应用", exact: true }).click();
  await expect(dialog.getByText("已应用：同时处理 3 份试卷")).toBeVisible();
  const input = dialog.getByLabel("选择 PDF 文件");
  await input.setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(dialog.getByRole("alert")).toContainText("仅支持 PDF");
  await input.setInputFiles(Array.from({ length: 1001 }, (_, i) => ({ name: `${i}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") })));
  await expect(dialog.getByRole("alert")).toContainText("最多导入 1000 份");
  await input.setInputFiles(Array.from({ length: 1000 }, (_, i) => ({ name: `${i}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") })));
  await expect(dialog.getByText("已选 1000 份", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "清空", exact: true }).click();
  await input.setInputFiles([{ name: "待导入一.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") }, { name: "待导入二.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") }]);
  await expect(dialog.getByText("已选 2 份", { exact: true })).toBeVisible();
  await expect(dialog.locator(".wb-file-selection li")).toHaveCount(2);
  await dialog.getByRole("button", { name: "移除 待导入一.pdf" }).click();
  const transfer = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(["%PDF-1.4"], "拖放试卷.pdf", { type: "application/pdf" })); return dt; });
  await dialog.locator(".wb-drop-zone").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dialog.locator(".wb-file-selection li")).toHaveCount(2);
  expect(posts).toBe(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.locator(".wb-dialog-body").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: "tmp/workbench-import-drawer.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.locator(".wb-file-selection li")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(390);
  await dialog.locator(".wb-dialog-body").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: "tmp/workbench-import-mobile.png" });
  await dialog.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
});

test("有效 PDF 保存原卷和分页后移交试卷管理，导入弹窗清空", async ({ page, browser }) => {
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(`<h1>Workbench PDF ${crypto.randomUUID()}</h1><p>1. Solve x + 1 = 2.</p>`);
  const buffer = await pdfPage.pdf({ format: "A4" });
  await pdfPage.close();
  const name = `导入验收-${crypto.randomUUID()}.pdf`;
  const requests = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/documents" && request.method() === "POST") requests.push(request); });
  await page.goto("/");
  await page.getByRole("button", { name: "导入试卷", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入试卷" });
  await dialog.getByLabel("选择 PDF 文件").setInputFiles({ name, mimeType: "application/pdf", buffer });
  expect(requests).toHaveLength(0);
  await expect(dialog.getByRole("button", { name: "开始导入" })).toBeEnabled();
  await dialog.getByRole("button", { name: "开始导入" }).click();
  await expect(dialog.getByRole("status")).toContainText("原卷已保存", { timeout: 25000 });
  await expect(dialog.locator(".wb-upload-tasks")).toHaveCount(0);
  await expect(dialog.locator(".wb-file-selection")).toHaveCount(0);
  const result = await (await page.request.get("/api/documents")).json();
  const uploaded = result.documents.find(document => document.name === name);
  expect(uploaded).toBeTruthy();
  expect(uploaded.pageCount).toBe(1);
  expect(uploaded.status).toBe("awaiting_model");
  expect(uploaded.jobStatus).toBeFalsy();
  expect(requests.length).toBeGreaterThanOrEqual(1);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: /^正在导入/ })).toHaveCount(0);
  await page.getByRole("tab", { name: /^待处理/ }).click();
  await expect(page.locator(".document-main strong", { hasText: name })).toBeVisible();
  await page.reload();
  const row = page.locator(".wb-table tbody tr", { hasText: name });
  await expect(row).toContainText("等待配置模型");
  await expect(row.getByRole("button", { name: `开始识别 ${name}` })).toBeVisible();
  await page.request.delete(`/api/documents/${uploaded.id}`, { data: { mode: "with_questions" } });
});

test("唯一模型未选中时显示占位项，选择后才保存模型选择", async ({ page }) => {
  let selected = null;
  let changes = 0;
  await page.route("**/api/model-profiles", async route => {
    if (route.request().method() === "PATCH") {
      selected = route.request().postDataJSON().selectedProfileId;
      changes++;
    }
    await route.fulfill({ json: { profiles: [{ id: "only", displayName: "唯一已配置模型", model: "test", apiKeyMask: "configured" }], selectedProfileId: selected } });
  });
  await page.goto("/?import=1");
  const select = page.getByLabel("选择识别模型");
  await expect(select).toHaveValue("");
  await expect(select.locator("option:checked")).toHaveText("请选择识别模型");
  expect(changes).toBe(0);
  await select.selectOption("only");
  await expect.poll(() => selected).toBe("only");
  expect(changes).toBe(1);
});

test("无队列文档可记录待选模型，已有任务时拒绝覆盖", async ({ request }) => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"));
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,created_at,updated_at) VALUES (?,'workbench-browser','入队状态测试','application/pdf','extracting',?,?)").run(id,stamp,stamp);
  const response = await request.patch(`/api/documents/${id}`, { data: { status: "awaiting_model", error: "请选择模型" } });
  expect(response.status()).toBe(200);
  expect(db.prepare("SELECT status FROM documents WHERE id=?").pluck().get(id)).toBe("awaiting_model");
  db.prepare("UPDATE documents SET status='extracting' WHERE id=?").run(id);
  db.prepare("INSERT INTO document_jobs (document_id,owner_id,status,queued_at,updated_at) VALUES (?,'workbench-browser','paused',?,?)").run(id,stamp,stamp);
  expect((await request.patch(`/api/documents/${id}`, { data: { status: "awaiting_model" } })).status()).toBe(409);
  expect(db.prepare("SELECT status FROM documents WHERE id=?").pluck().get(id)).toBe("extracting");
  db.prepare("DELETE FROM document_jobs WHERE document_id=?").run(id);
  db.prepare("DELETE FROM documents WHERE id=?").run(id);
  db.close();
});

test("表格删除确认支持取消、保留题目与批量删除", async ({ page }) => {
  const fixture = papers();
  try {
    await page.goto("/");
    await page.getByRole("tab", { name: /^全部/ }).click();
    await page.getByRole("searchbox").fill("工作台验收");
    const complete = fixture.items[7];
    await page.getByRole("button", { name: `删除 ${complete.name}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "删除试卷", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect(fixture.db.prepare("SELECT id FROM documents WHERE id=?").get(complete.id)).toBeTruthy();
    await page.getByRole("button", { name: `删除 ${complete.name}`, exact: true }).click();
    await dialog.getByRole("button", { name: /只删除试卷，保留已入库题目/ }).click();
    await expect(dialog).not.toBeVisible();
    expect(fixture.db.prepare("SELECT COUNT(*) FROM questions WHERE document_id=?").pluck().get(complete.id)).toBe(4);
    expect(fixture.db.prepare("SELECT source_removed_at FROM documents WHERE id=?").pluck().get(complete.id)).toBeTruthy();
    await page.getByRole("button", { name: "批量操作", exact: true }).click();
    for (const item of fixture.items.slice(0, 2)) await page.getByLabel(`选择 ${item.name}`).check();
    await page.getByRole("button", { name: "批量删除", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /同步删除试卷和题目/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const item of fixture.items.slice(0, 2)) expect(fixture.db.prepare("SELECT id FROM documents WHERE id=?").get(item.id)).toBeUndefined();
  } finally { fixture.close(); }
});

test("五份原卷交给后台后清空，删除试卷再打开不残留", async ({ page }) => {
  const fixture = papers();
  let posts = 0;
  await page.route("**/api/model-profiles", route => route.fulfill({ json: { profiles: [], selectedProfileId: "" } }));
  await page.route(/\/api\/documents(?:\?.*)?$/, route => route.request().method() === "POST"
    ? route.fulfill({ json: { id: fixture.items[posts++].id, preparationQueued: true, status: "uploading" } }) : route.continue());
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "导入试卷", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入试卷" });
    await dialog.getByLabel("选择 PDF 文件").setInputFiles(Array.from({ length: 5 }, (_, index) => ({ name: "后台准备-" + index + ".pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") })));
    await dialog.getByRole("button", { name: "开始导入" }).click();
    await expect.poll(() => posts).toBe(5);
    await expect(dialog.locator(".wb-file-selection")).toHaveCount(0);
    await expect(dialog.locator(".wb-upload-tasks")).toHaveCount(0);
    await expect(dialog.getByRole("status")).toContainText("试卷管理");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("tab", { name: /^全部/ }).click();
    await page.getByRole("button", { name: "批量操作" }).click();
    await page.getByRole("button", { name: "全选本页", exact: true }).click();
    await page.getByRole("button", { name: "批量删除", exact: true }).click();
    await page.getByRole("button", { name: /同步删除试卷和题目/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "把手里的试卷，变成自己的题库" })).toBeVisible();
    await page.getByRole("button", { name: "导入试卷", exact: true }).click();
    await expect(dialog.locator(".wb-upload-tasks")).toHaveCount(0);
    await expect(dialog.locator(".wb-file-selection")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "开始导入" })).toBeDisabled();
  } finally { fixture.close(); }
});

test("上传期间关闭重开保留当前任务，失败可见，新批次不累计旧任务", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let received = false;
  await page.route("**/api/model-profiles", route => route.fulfill({ json: { profiles: [], selectedProfileId: "" } }));
  await page.route(/\/api\/documents(?:\?.*)?$/, async route => {
    if (route.request().method() !== "POST") return route.continue();
    received = true;
    await gate;
    return route.fulfill({ status: 400, json: { error: "测试上传失败" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "导入试卷", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入试卷" });
  await dialog.getByLabel("选择 PDF 文件").setInputFiles({ name: "第一批.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await dialog.getByRole("button", { name: "开始导入" }).click();
  await expect.poll(() => received).toBe(true);
  await expect(dialog.locator(".wb-file-selection")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^正在导入/ }).click();
  await expect(dialog.locator(".wb-upload-tasks")).toContainText("第一批.pdf");
  release();
  await expect(dialog.locator(".wb-upload-tasks")).toContainText("测试上传失败");
  await dialog.getByLabel("选择 PDF 文件").setInputFiles({ name: "第二批.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await dialog.getByRole("button", { name: "开始导入" }).click();
  await expect(dialog.locator(".wb-upload-tasks article")).toHaveCount(1);
  await expect(dialog.locator(".wb-upload-tasks")).toContainText("第二批.pdf");
  await expect(dialog.locator(".wb-upload-tasks")).not.toContainText("第一批.pdf");
});

test("同步失败保留现有数据，模型配置失败明确提示并可重开恢复", async ({ page }) => {
  const fixture = papers();
  let failDocuments = true, failModels = true;
  await page.route(url => url.pathname === "/api/documents", route => failDocuments ? route.fulfill({ status: 503, json: { error: "试卷状态暂不可用" } }) : route.continue());
  await page.route("**/api/model-profiles", route => failModels ? route.fulfill({ status: 503, json: { error: "模型配置暂不可用" } }) : route.continue());
  try {
    await page.goto("/");
    await expect(page.locator(".workbench").getByRole("alert")).toContainText("试卷状态暂不可用");
    await expect(page.locator(".wb-table tbody tr")).toHaveCount(10);
    failDocuments = false;
    await expect(page.locator(".workbench").getByRole("alert")).toHaveCount(0, { timeout: 8000 });
    await page.getByRole("button", { name: "导入试卷", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入试卷" });
    await expect(dialog.getByRole("status")).toContainText("模型配置暂不可用");
    await dialog.getByLabel("选择 PDF 文件").setInputFiles({ name: "待恢复.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    await expect(dialog.getByRole("button", { name: "开始导入" })).toBeDisabled();
    await page.keyboard.press("Escape");
    failModels = false;
    await page.getByRole("button", { name: "导入试卷", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "开始导入" })).toBeEnabled();
  } finally { fixture.close(); }
});


test("识别试卷置顶，双进度独立刷新且桌面手机均保持原行高", async ({ page }) => {
  const fixture = papers();
  const { db } = fixture;
  const active = fixture.items[0];
  const stamp = new Date().toISOString();
  db.prepare("UPDATE documents SET status='extracting',created_at='2020-01-01' WHERE id=?").run(active.id);
  db.prepare("UPDATE extraction_runs SET status='running' WHERE document_id=?").run(active.id);
  db.prepare("INSERT INTO document_jobs (document_id,owner_id,status,ai_review_enabled,question_total,completed_question_numbers_json,lease_expires_at,queued_at,updated_at) VALUES (?,'workbench-browser','processing',1,8,?,'2099-01-01',?,?)").run(active.id, JSON.stringify(['1','2','3']), stamp, stamp);
  for (const [number,status] of [['1','passed'],['2','pending'],['3','failed'],['4','passed']]) {
    db.prepare("UPDATE questions SET ai_review_json=? WHERE document_id=? AND number=?").run(JSON.stringify({ status }),active.id,number);
  }
  try {
    await page.goto('/');
    await page.getByRole('tab',{name:/^全部/}).click();
    for (const sort of ['newest','oldest','name']) {
      await page.getByLabel('试卷排序').selectOption(sort);
      await expect(page.locator('.document-main strong').first()).toHaveText(active.name);
    }
    const row=page.locator('.wb-table tbody tr',{hasText:active.name});
    const recognition=row.getByRole('progressbar',{name:active.name+' 识别进度',exact:true});
    const review=row.getByRole('progressbar',{name:active.name+' AI复核进度',exact:true});
    await expect(recognition).toHaveAttribute('aria-valuetext','3/8 题');
    await expect(review).toHaveAttribute('aria-valuetext','1/8 题，1 题复核失败');
    // A review from a prior attempt (question 4) must not be counted yet.
    db.prepare("UPDATE questions SET ai_review_json=? WHERE document_id=? AND number='2'").run(JSON.stringify({status:'issues'}),active.id);
    await expect(review).toHaveAttribute('aria-valuetext','2/8 题，1 题复核失败',{timeout:8000});
    await expect(recognition).toHaveAttribute('aria-valuetext','3/8 题');
    db.prepare("UPDATE document_jobs SET completed_question_numbers_json=? WHERE document_id=?").run(JSON.stringify(['1','2','3','4']), active.id);
    await expect(recognition).toHaveAttribute('aria-valuetext','4/8 题',{timeout:8000});
    await expect(review).toHaveAttribute('aria-valuenow','38');
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      const activeHeight=(await row.boundingBox()).height;
      const normalHeight=(await page.locator('.wb-table tbody tr',{hasText:fixture.items[1].name}).boundingBox()).height;
      expect(activeHeight).toBeLessThanOrEqual(normalHeight+1);
      expect(activeHeight).toBeLessThanOrEqual(72);
      await page.screenshot({path:'tmp/workbench-dual-progress-'+width+'.png',fullPage:true});
    }
    db.prepare("UPDATE document_jobs SET question_total=NULL,completed_question_numbers_json='[]' WHERE document_id=?").run(active.id);
    await expect(recognition).toHaveAttribute('aria-valuetext','0/待确认 题',{timeout:8000});
    await expect(recognition).not.toHaveAttribute('aria-valuenow');
  } finally { fixture.close(); }
});


test("超过列表上限时旧的识别任务仍会被返回并置顶", async ({ request }) => {
  const fixture=papers();
  const stamp=new Date().toISOString();
  const active=fixture.items[0];
  fixture.db.prepare("UPDATE documents SET status='extracting',created_at='2020-01-01' WHERE id=?").run(active.id);
  fixture.db.prepare("INSERT INTO document_jobs (document_id,owner_id,status,lease_expires_at,queued_at,updated_at) VALUES (?,'workbench-browser','processing','2099-01-01',?,?)").run(active.id,stamp,stamp);
  for(let index=0;index<100;index++) {
    const id=crypto.randomUUID();
    fixture.db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,grade,created_at,updated_at) VALUES (?,'workbench-browser','较新的试卷','application/pdf','failed',0,'数学','高三',?,?)").run(id,stamp,stamp);
    fixture.items.push({id});
  }
  try {
    const response=await request.get('/api/documents');
    expect(response.ok()).toBe(true);
    const result=await response.json();
    expect(result.documents).toHaveLength(50);
    expect(result.pagination.total).toBeGreaterThanOrEqual(110);
    expect(result.pagination.totalPages).toBeGreaterThanOrEqual(3);
    expect(result.documents[0].id).toBe(active.id);
  } finally {fixture.close();}
});
