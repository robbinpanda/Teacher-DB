import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

// Other suites create pending questions and models; use a separate teacher here.
test.use({ extraHTTPHeaders: { "oai-authenticated-user-id": "bulk-approve-browser" } });

function fixture({ owner = "bulk-approve-browser", review = false, incomplete = false } = {}) {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"));
  db.pragma("foreign_keys = ON");
  const id = crypto.randomUUID(), pageId = crypto.randomUUID(), now = new Date().toISOString();
  const name = `一键入库测试-${id.slice(0, 8)}`;
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,created_at,updated_at) VALUES (?,?,?,'application/pdf','reviewing',?,'数学',?,?)").run(id, owner, name, incomplete ? 2 : 1, now, now);
  db.prepare("INSERT INTO pages (id,document_id,page_number,storage_key,width,height,created_at) VALUES (?,?,1,'fixture.png',600,800,?)").run(pageId, id, now);
  db.prepare("INSERT INTO extraction_runs (id,document_id,page_id,page_number,provider,model,status,created_at,finished_at) VALUES (?,?,?,1,'openai-chat-completions','fixture','complete',?,?)").run(crypto.randomUUID(), id, pageId, now, now);
  const questionIds = [];
  for (let index = 0; index < (review ? 2 : 1); index += 1) {
    const questionId = crypto.randomUUID();
    questionIds.push(questionId);
    db.prepare("INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,page_number,bbox_json,confidence,needs_human_review,status,created_at,updated_at) VALUES (?,?,?,'fill','测试题干','1','测试解析',1,'{}',0.95,?,?,?,?)").run(questionId, id, String(index + 1), index === 1 ? 1 : 0, index === 1 ? "needs_attention" : "pending", now, now);
  }
  return { id, name, questionIds, db, close() { db.prepare("DELETE FROM documents WHERE id = ?").run(id); db.close(); } };
}

test("列表外层一键入库，无需勾选；全部可入库后自动切换已入库且刷新保留", async ({ page }) => {
  const first = fixture(), second = fixture(), other = fixture({ owner: "other-teacher" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto("/");
    await page.getByRole("tab", { name: /待审核/ }).click();
    await expect(page.locator('.document-selector')).toHaveCount(0);
    await page.getByRole("button", { name: "一键全部入库", exact: true }).click();
    await expect(page.getByRole("tab", { name: /已入库/ })).toHaveAttribute("aria-selected", "true");
    for (const f of [first, second]) {
      await expect(page.locator('.document-main strong', { hasText: f.name })).toBeVisible();
      expect(f.db.prepare("SELECT status FROM documents WHERE id = ?").pluck().get(f.id)).toBe("complete");
      expect(f.db.prepare("SELECT status FROM questions WHERE document_id = ?").pluck().all(f.id)).toEqual(["approved"]);
    }
    expect(other.db.prepare("SELECT status FROM questions WHERE document_id = ?").pluck().get(other.id)).toBe("pending");
    await page.reload();
    await expect(page.getByRole("tab", { name: /已入库/ })).toHaveAttribute("aria-selected", "true");
    const repeat = await page.request.post("/api/documents/bulk", { data: { action: "approve_all_without_review" } });
    expect(repeat.status()).toBe(200);
    expect((await repeat.json()).changed).toBe(0);
    expect(errors).toEqual([]);
  } finally { first.close(); second.close(); other.close(); }
});

test("一键入库保留需复核题目，完整性异常单独提示且不阻止其他试卷", async ({ page }) => {
  const ready = fixture(), mixed = fixture({ review: true }), incomplete = fixture({ incomplete: true });
  try {
    await page.goto("/");
    await page.getByRole("tab", { name: /待审核/ }).click();
    await page.getByRole("button", { name: "一键全部入库", exact: true }).click();
    await expect(page.locator('.document-bulk-notice')).toContainText("仍有 1 道需人工复核");
    await expect(page.locator('.document-bulk-warning')).toContainText(incomplete.name);
    await expect(page.getByRole("tab", { name: /待审核/ })).toHaveAttribute("aria-selected", "true");
    expect(ready.db.prepare("SELECT status FROM documents WHERE id = ?").pluck().get(ready.id)).toBe("complete");
    expect(mixed.db.prepare("SELECT status FROM questions WHERE document_id = ? ORDER BY number").pluck().all(mixed.id)).toEqual(["approved", "needs_attention"]);
    expect(mixed.db.prepare("SELECT status FROM documents WHERE id = ?").pluck().get(mixed.id)).toBe("reviewing");
    expect(incomplete.db.prepare("SELECT status FROM questions WHERE document_id = ?").pluck().get(incomplete.id)).toBe("pending");
    await page.getByRole("tab", { name: /已入库/ }).click();
    await expect(page.locator('.document-main strong', { hasText: ready.name })).toBeVisible();
  } finally { ready.close(); mixed.close(); incomplete.close(); }
});
