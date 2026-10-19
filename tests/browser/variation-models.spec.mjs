import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const owner = "variation-models-browser";
test.use({ extraHTTPHeaders: { "oai-authenticated-user-id": owner } });
const profiles = [
  { id: "generator-a", displayName: "生成模型 A", enabled: true, apiKeyMask: "***1234" },
  { id: "generator-b", displayName: "生成模型 B", enabled: true, apiKeyMask: "***5678" },
  { id: "no-key", displayName: "未配置模型", enabled: true, apiKeyMask: null },
  { id: "disabled", displayName: "停用模型", enabled: false, apiKeyMask: "***1234" },
];

test.beforeAll(() => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"));
  const stamp = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO documents (id,owner_id,name,mime_type,status,subject,grade,created_at,updated_at) VALUES (?,?,?,'application/pdf','complete','数学','九年级',?,?)").run("variation-browser-doc", owner, "变式模型测试", stamp, stamp);
  db.prepare("INSERT OR IGNORE INTO questions (id,document_id,number,type,stem,answer,analysis,status,needs_human_review,page_number,bbox_json,created_at,updated_at) VALUES (?,?,'1','fill',?,'2','1+1=2','approved',0,1,'{}',?,?)").run("variation-browser-question", "variation-browser-doc", "求 1+1 的值。", stamp, stamp);
  db.close();
});

async function openDialog(page) {
  await page.goto("/bank");
  await page.getByRole("button", { name: "生成变式", exact: true }).click();
  return page.getByRole("dialog", { name: "生成变式题", exact: true });
}

test("选择本次生成和审校模型，保留失败设置并以新请求重试，兼容手机", async ({ page }) => {
  const requests = []; let mutations = 0;
  await page.route("**/api/model-profiles", route => {
    if (route.request().method() !== "GET") mutations++;
    return route.fulfill({ json: { profiles, selectedProfileId: "generator-a" } });
  });
  await page.route("**/api/questions/*/variations", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 504, json: { status: "failed", runId: "fake-run", error: "候选生成失败：已自动重试 1 次，仍未完成：模型调用超时" } });
  });
  const dialog = await openDialog(page);
  await expect(dialog.getByLabel("生成模型", { exact: true })).toHaveValue("generator-a");
  await expect(dialog.getByLabel("生成模型", { exact: true }).locator('option[value="no-key"]')).toHaveJSProperty("disabled", true);
  await expect(dialog.getByLabel("生成模型", { exact: true }).locator('option[value="disabled"]')).toHaveCount(0);
  await dialog.getByLabel("生成模型", { exact: true }).selectOption("generator-b");
  await dialog.getByLabel("审校模型（可选）").selectOption("generator-a");
  await dialog.getByRole("combobox", { name: /^难度/ }).selectOption("harder");
  await dialog.getByLabel("希望重点改变什么（可选）").fill("保持整数答案");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(dialog.getByLabel("生成模型", { exact: true })).toBeVisible();
    await page.screenshot({ path: `tmp/variation-model-selection-${width}.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await dialog.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("候选生成失败");
  await expect(dialog.getByLabel("生成模型", { exact: true })).toHaveValue("generator-b");
  await expect(dialog.getByLabel("希望重点改变什么（可选）")).toHaveValue("保持整数答案");
  await dialog.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ profileId: "generator-b", reviewerProfileId: "generator-a", difficulty: "harder", focus: "保持整数答案", qualityMode: "reviewed" });
  expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
  await dialog.getByRole("button", { name: "快速生成" }).click();
  await expect(dialog.getByLabel("生成模型", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("审校模型（可选）")).toHaveCount(0);
  await dialog.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(requests[2].profileId).toBe("generator-b");
  expect(requests[2].reviewerProfileId).toBeUndefined();
  expect(mutations).toBe(0);
});

test("网络状态不明时锁定原设置并复用请求，不重复生成", async ({ page }) => {
  const requests = [];
  await page.route("**/api/model-profiles", route => route.fulfill({ json: { profiles, selectedProfileId: "generator-a" } }));
  await page.route("**/api/questions/*/variations", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 502, json: { error: "后台连接中断" } });
  });
  const dialog = await openDialog(page);
  await dialog.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("任务状态尚未确认");
  await expect(dialog.getByLabel("生成模型", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "重试获取结果" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("模型列表加载失败可重试，无可用模型时禁止生成并提供配置入口", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/model-profiles", route => {
    calls++;
    return route.fulfill(calls === 1 ? { status: 503, json: { error: "模型列表暂不可用" } } : { json: { profiles: profiles.slice(2) } });
  });
  const dialog = await openDialog(page);
  await expect(dialog.getByRole("alert")).toContainText("模型列表暂不可用");
  await expect(dialog.getByRole("button", { name: "开始生成", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "重新加载模型" }).click();
  await expect(dialog.getByText(/暂无可用模型/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "模型配置" })).toHaveAttribute("href", "/settings/models");
  await expect(dialog.getByRole("button", { name: "开始生成", exact: true })).toBeDisabled();
});
