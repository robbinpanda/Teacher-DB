import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

test.use({ extraHTTPHeaders: { "oai-authenticated-user-id": "workbench-browser" } });

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
        await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "教学 Skills" })).toBeVisible();
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
  await dialog.getByLabel("学段", { exact: true }).selectOption("high");
  await dialog.getByLabel("学科", { exact: true }).selectOption("物理");
  await dialog.getByLabel("年级", { exact: true }).selectOption("高二");
  await dialog.getByLabel("选择识别模型").selectOption("two");
  await expect.poll(() => selected).toBe("two");
  await expect(dialog.getByText(/当前模型尚未配置 API Key/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "管理模型" })).toHaveAttribute("href", "/settings/models");
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
  await input.setInputFiles(Array.from({ length: 101 }, (_, i) => ({ name: `${i}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") })));
  await expect(dialog.getByRole("alert")).toContainText("最多导入 100 份");
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

test("有效 PDF 在点击开始后使用真实上传接口保存原卷和分页，关闭抽屉仍显示任务", async ({ page, browser }) => {
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
  await expect(dialog.locator(".wb-upload-tasks")).toContainText("原卷和分页图已经安全保存", { timeout: 25000 });
  const result = await (await page.request.get("/api/documents")).json();
  const uploaded = result.documents.find(document => document.name === name);
  expect(uploaded).toBeTruthy();
  expect(uploaded.pageCount).toBe(1);
  expect(requests.length).toBeGreaterThanOrEqual(1);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: /^导入任务/ })).toBeVisible();
  await page.getByRole("tab", { name: /^待处理/ }).click();
  await expect(page.locator(".document-main strong", { hasText: name })).toBeVisible();
  await page.request.delete(`/api/documents/${uploaded.id}`, { data: { mode: "with_questions" } });
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

test("后台准备进度按间隔同步，关闭再打开抽屉不丢任务", async ({ page }) => {
  let queueCalls = 0, complete = false;
  const id = crypto.randomUUID();
  await page.route("**/api/model-profiles", route => route.fulfill({ json: { profiles: [], selectedProfileId: "" } }));
  await page.route("**/api/documents", route => route.request().method() === "POST"
    ? route.fulfill({ json: { id, preparationQueued: true, status: "uploading" } }) : route.continue());
  await page.route("**/api/extraction-queue", route => {
    queueCalls++;
    return route.fulfill({ json: { concurrency: 2, activeCount: 0, queuedCount: 0, jobs: [], preparations: [{ documentId: id, status: complete ? "complete" : "processing", completedPages: complete ? 1 : 0, pageCount: 1 }] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "导入试卷", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入试卷" });
  await dialog.getByLabel("选择 PDF 文件").setInputFiles({ name: "后台准备.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await dialog.getByRole("button", { name: "开始导入" }).click();
  await expect(dialog.locator(".wb-upload-tasks")).toContainText("后台正在准备页面");
  const callsAfterStart = queueCalls;
  // A task update must not restart its effect and immediately poll in a tight loop.
  await page.waitForTimeout(1200);
  expect(queueCalls - callsAfterStart).toBeLessThanOrEqual(2);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: /^导入任务/ }).click();
  await expect(dialog.locator(".wb-upload-tasks")).toContainText("后台准备.pdf");
  complete = true;
  await expect(dialog.locator(".wb-upload-tasks")).toContainText("原卷分页已保存", { timeout: 8000 });
});

test("同步失败保留现有数据，模型配置失败明确提示并可重开恢复", async ({ page }) => {
  const fixture = papers();
  let failDocuments = true, failModels = true;
  await page.route("**/api/documents", route => failDocuments ? route.fulfill({ status: 503, json: { error: "试卷状态暂不可用" } }) : route.continue());
  await page.route("**/api/model-profiles", route => failModels ? route.fulfill({ status: 503, json: { error: "模型配置暂不可用" } }) : route.continue());
  try {
    await page.goto("/");
    await expect(page.locator(".workbench").getByRole("alert")).toContainText("试卷状态暂不可用");
    await expect(page.locator(".wb-table tbody tr")).toHaveCount(7);
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
