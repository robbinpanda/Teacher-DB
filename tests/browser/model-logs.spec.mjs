import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { ModelCallTrace } from "../../lib/model-call-trace.ts";

async function fixture() {
  const root = process.env.JIANTI_E2E_DATA_DIR;
  const db = new Database(path.join(root, "teacher-question-bank.sqlite3"));
  const id = crypto.randomUUID(), now = new Date().toISOString();
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,error,created_at,updated_at) VALUES (?,'local-demo','日志浏览器测试卷','application/pdf','failed',21,'缺少第21题',?,?)").run(id, now, now);
  db.close();
  const context = { ownerId: "local-demo", profileId: "fixture", provider: "openai-chat-completions", model: "fixture-model", purpose: "page_extraction", documentId: id, extractionAttempt: 1 };
  const failed = new ModelCallTrace(root, context);
  const response = await failed.fetch("https://fixture.example/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer private-key" }, body: JSON.stringify({ messages: [{ role: "system", content: "请按可见题号识别 SYSTEM_PROMPT_MARKER" }, { role: "user", content: [{ type: "text", text: "本次试卷提示 USER_PROMPT_MARKER" }] }] }) }, async () => new Response("原始HTTP回复_RAW_MARKER" + "中文🙂".repeat(18000)));
  await response.text(); failed.output("text", '{"event":"meta","questionCount":21}\nMODEL_REPLY_MARKER');
  failed.finish("complete"); failed.validation("failed", { error: "模型声明21题，实际返回20题，缺少第21题" });
  const success = new ModelCallTrace(root, context); success.output("text", "SUCCESS_REPLY_MARKER"); success.finish("complete"); success.validation("complete", { questionTotal: 20, questionNumbers: ["1", "20"] });
  return { id, failed, success };
}

test("从失败审核页查看历史、提示词、完整回复和校验错误；大原始流可分页", async ({ page }) => {
  const { id } = await fixture();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/review/${id}`);
  await page.getByRole("link", { name: "查看识别日志" }).click();
  await expect(page.getByRole("heading", { name: "识别日志", exact: true })).toBeVisible();
  await expect(page.getByText("校验通过", { exact: true })).toBeVisible();
  await page.getByLabel("只看失败").check();
  await page.getByRole("button", { name: /模型声明21题，实际返回20题/ }).click();
  await expect(page.getByText("识别结果校验失败", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提示词", exact: true }).click();
  await expect(page.getByText("请按可见题号识别 SYSTEM_PROMPT_MARKER", { exact: true })).toBeVisible();
  await expect(page.getByText("本次试卷提示 USER_PROMPT_MARKER", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "原始回复", exact: true }).click();
  await expect(page.locator("pre")).toContainText("MODEL_REPLY_MARKER");
  await page.getByRole("button", { name: "原始流与更多", exact: true }).click();
  await page.getByLabel("日志文件", { exact: true }).selectOption("response-1.raw");
  await expect(page.locator("pre")).toContainText("原始HTTP回复_RAW_MARKER");
  await page.getByRole("button", { name: "下一段" }).click();
  await expect(page.getByText(/第 2 段/)).toBeVisible();
  await expect(page.locator("pre")).not.toContainText("�");
  await page.getByRole("button", { name: "上一段" }).click();
  await expect(page.locator("pre")).toContainText("原始HTTP回复_RAW_MARKER");
  expect(errors).toEqual([]);
});

test("日志API拒绝跨教师、跨试卷、非法文件名及修改请求；空历史有明确说明", async ({ page }) => {
  const first = await fixture(), second = await fixture();
  const api = `/api/documents/${first.id}/model-traces`;
  expect((await page.request.get(api, { headers: { "oai-authenticated-user-id": "other-teacher" } })).status()).toBe(404);
  expect((await page.request.get(`${api}/${second.failed.id}`)).status()).toBe(404);
  expect((await page.request.get(`${api}/${first.failed.id}/content?file=../../.env`)).status()).toBe(404);
  expect((await page.request.get(`${api}/${first.failed.id}/content?offset=-1`)).status()).toBe(400);
  expect((await page.request.post(api)).status()).toBe(405);
  const response = await page.request.get(`${api}/${first.failed.id}/content?file=request-1.json`);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).not.toContain("private-key");
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"));
  db.prepare("UPDATE documents SET id=? WHERE id=?").run("empty-log-paper", second.id); db.close();
  await page.goto("/review/empty-log-paper/logs");
  await expect(page.getByRole("heading", { name: "暂无模型调用日志" })).toBeVisible();
});
