import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

test("逐题审核替代置信度，显示问题/失败/通过，修改后立即失效并可重试", async ({ page }, testInfo) => {
  const root = process.env.JIANTI_E2E_DATA_DIR;
  const db = new Database(path.join(root, "teacher-question-bank.sqlite3"));
  const id = crypto.randomUUID(), qid = crypto.randomUUID(), pid = crypto.randomUUID(), now = new Date().toISOString();
  const key = `documents/${id}/page.png`;
  await fs.mkdir(path.join(root, "files", "documents", id), { recursive: true });
  await fs.writeFile(path.join(root, "files", key), await sharp({ create: { width: 600, height: 800, channels: 3, background: "white" } }).png().toBuffer());
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,created_at,updated_at) VALUES (?,'local-demo','逐题审核测试卷','image/png','reviewing',1,'数学',?,?)").run(id, now, now);
  db.prepare("INSERT INTO pages (id,document_id,page_number,storage_key,width,height,created_at) VALUES (?,?,1,?,600,800,?)").run(pid, id, key, now);
  db.prepare("INSERT INTO extraction_runs (id,document_id,page_id,page_number,provider,model,status,created_at,finished_at) VALUES (?,?,?,1,'fixture','fixture','complete',?,?)").run(crypto.randomUUID(), id, pid, now, now);
  const audit = { mode: "saved_content_v1", categories: ["缺图", "其他问题"], status: "issues", token: "fixture", sourcePages: [1], answerPages: [1] };
  db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,page_number,bbox_json,status,needs_human_review,confidence,ai_review_json,created_at,updated_at) VALUES (?,?,'1','fill','计算 $1+1$','2','相加得2',1,?,'needs_attention',1,0.99,?,?,?)")
    .run(qid, id, JSON.stringify({ x: 5, y: 5, width: 90, height: 20 }), JSON.stringify(audit), now, now);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`/review/${id}`);
    await expect(page.locator(".ai-review-state")).toHaveText("AI 审核：缺图、其他问题");
    await expect(page.getByText("请核查本题保存的文字和配图：缺图、其他问题。", { exact: true })).toBeVisible();
    await expect(page.locator(".confidence-score")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重新 AI 审核", exact: true })).toBeEnabled();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`ai-review-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    db.prepare("UPDATE questions SET ai_review_json=? WHERE id=?").run(JSON.stringify({ ...audit, status: "failed", error: "模拟超时" }), qid);
    await page.reload();
    await expect(page.locator(".ai-review-state")).toHaveText("AI 审核未完成");
    await expect(page.getByText("模拟超时", { exact: true })).toBeVisible();
    // Verify the real frontend proxy/backend route before mocking the model verdict UI.
    const missing = await page.request.post("/api/questions/nonexistent-fixture/ai-review");
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error).toBe("题目不存在");
    await page.route(`**/api/questions/${qid}/ai-review`, route => route.fulfill({ json: { aiReview: { ...audit, status: "passed" }, needsHumanReview: false, status: "pending" } }));
    await page.getByRole("button", { name: "重新 AI 审核", exact: true }).click();
    await expect(page.locator(".ai-review-state")).toHaveText("AI 审核：没问题");
    await page.getByRole("button", { name: "编辑题干 LaTeX", exact: true }).click();
    await page.getByRole("textbox", { name: "题干 LaTeX", exact: true }).fill("计算 $1-1$");
    await expect(page.locator(".ai-review-state")).toHaveText("内容已修改，待 AI 重审");
    expect(errors).toEqual([]);
  } finally { db.close(); }
});
