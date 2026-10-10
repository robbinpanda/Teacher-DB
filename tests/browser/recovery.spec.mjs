import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

function pendingDocument(status = "failed") {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO documents (id, owner_id, name, mime_type, status, page_count, created_at, updated_at)
    VALUES (?, 'local-demo', 'Browser recovery fixture', 'application/pdf', ?, 18, ?, ?)`).run(id, status, now, now);
  db.close();
  return id;
}

test("首次进入缺少分页图的审核页会显示恢复入口", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/review/${pendingDocument()}`);
  await expect(page.getByText("等待原卷页面", { exact: true })).toBeVisible();
  await expect(page.getByText(/原卷分页图尚未保存/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重新识别整卷" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("非 JSON 进度响应会重试，已有 reviewing 状态不会触发刷新循环", async ({ page }) => {
  const id = pendingDocument("reviewing");
  const errors = [];
  let calls = 0;
  let navigations = 0;
  page.on("pageerror", error => errors.push(error.message));
  // Next hydration can emit framenavigated for replaceState. Count actual
  // document requests so a history update is not mistaken for a reload.
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  await page.route(`**/api/documents/${id}/progress`, async route => {
    calls++;
    if (calls === 1) await route.fulfill({ status: 200, contentType: "text/plain", body: "Server starting" });
    else await route.continue();
  });
  await page.goto(`/review/${id}`);
  await expect.poll(() => calls).toBeGreaterThanOrEqual(3);
  expect(navigations).toBe(1);
  expect(errors).toEqual([]);
});

test("慢进度请求不会重复发出，断网恢复后继续显示审核页", async ({ page, context }) => {
  const id = pendingDocument();
  let calls = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/documents/${id}/progress`, async route => {
    calls++;
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto(`/review/${id}`);
  await expect.poll(() => calls).toBe(1);
  await page.waitForTimeout(2200);
  expect(calls).toBe(1);
  release();
  await page.unroute(`**/api/documents/${id}/progress`);
  await context.setOffline(true);
  await page.waitForTimeout(1200);
  await context.setOffline(false);
  await expect(page.getByText("等待原卷页面", { exact: true })).toBeVisible();
  const response = await page.request.get(`/api/documents/${id}/progress`);
  expect(response.status()).toBe(200);
});

test("独立 API 进程中断后自动恢复，浏览器会继续轮询", async ({ page }) => {
  test.skip(process.platform !== "win32", "Windows process recovery coverage; Linux uses supervisor SIGTERM handling");
  const id = pendingDocument();
  await page.goto(`/review/${id}`);
  const ready = await (await page.request.get("/api/ready")).json();
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"), { readonly: true });
  expect(db.prepare("SELECT 1 FROM runtime_processes WHERE role='api' AND pid=?").get(ready.pid)).toBeTruthy();
  db.close();
  const killer = spawn("taskkill", ["/PID", String(ready.pid), "/F"], { windowsHide: true, stdio: "ignore" });
  expect((await once(killer, "exit"))[0]).toBe(0);
  await expect.poll(async () => {
    const response = await page.request.get("/api/ready");
    if (response.status() !== 200) return false;
    return (await response.json()).pid !== ready.pid;
  }, { timeout: 15000 }).toBe(true);
  await expect(page.getByText("等待原卷页面", { exact: true })).toBeVisible();
  expect((await page.request.get(`/api/documents/${id}/progress`)).status()).toBe(200);
});
