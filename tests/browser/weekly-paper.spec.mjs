import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

test.use({ extraHTTPHeaders: { "oai-authenticated-user-id": "weekly-paper-teacher" }, viewport: { width: 1440, height: 960 } });

test("从多词检索生成周测、导出 Word，并筛掉刚用过的题", async ({ page }, info) => {
  const db = new Database(path.join(process.env.JIANTI_E2E_DATA_DIR, "teacher-question-bank.sqlite3"));
  const now = new Date().toISOString();
  const doc = crypto.randomUUID();
  try {
    db.prepare(`INSERT INTO documents (id, owner_id, name, mime_type, status, page_count, subject, grade, source_year, source_exam_type, created_at, updated_at)
      VALUES (?, 'weekly-paper-teacher', '九年级数学期末练习', 'application/pdf', 'complete', 1, '数学', '九年级', 2025, '期末', ?, ?)`).run(doc, now, now);
    const item = db.prepare(`INSERT INTO questions (id, document_id, number, type, stem, answer, analysis, status, needs_human_review, page_number, bbox_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 0, 1, '{}', ?, ?)`);
    const tag = crypto.randomUUID();
    db.prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(tag, "二次函数与图象", now);
    const questions = [
      ["fill", "已知二次函数 $y=x^2-4x+3$，其图象的对称轴是 ____。", "$x=2$", "配方可得 $y=(x-2)^2-1$。"],
      ["answer", "求二次函数 $y=x^2-2x-3$ 与横轴的两个交点，并写出函数值为负时的自变量取值范围。", "$(-1,0)$、$(3,0)$；$-1<x<3$。", "令函数值为零，因式分解得 $(x+1)(x-3)=0$。抛物线开口向上。"],
      ["fill", "将抛物线 $y=x^2$ 向上平移 2 个单位，所得图象的顶点是 ____。", "$(0,2)$", "顶点随图象向上平移。"],
    ];
    questions.forEach(([kind, stem, answer, analysis], index) => {
      const id = crypto.randomUUID();
      item.run(id, doc, String(index + 1), kind, stem, answer, analysis, now, now);
      db.prepare("INSERT INTO question_tags (question_id, tag_id) VALUES (?, ?)").run(id, tag);
    });
    await page.goto("/");
    await expect(page.getByText("九年级数学期末练习", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "导入试卷", exact: true }).click();
    const importer = page.getByRole("dialog", { name: "导入试卷" });
    await expect(importer.getByLabel("选择 PDF 或 Word 文件")).toHaveAttribute("accept", /\.docx/);
    await page.screenshot({ path: info.outputPath("workspace.png"), animations: "disabled" });
    await importer.getByRole("button", { name: "关闭导入" }).click();
    await page.getByRole("link", { name: "出一份周测" }).click();
    const draft = page.locator(".teaching-draft");
    await draft.getByRole("combobox", { name: "知识点", exact: true }).selectOption("二次函数与图象");
    await draft.getByLabel("题量").fill("2");
    await draft.getByRole("button", { name: "生成周测草稿" }).click();
    await expect(page.locator(".paper-order-item")).toHaveCount(2);
    await page.getByRole("button", { name: "保存试卷" }).click();
    await expect(page).toHaveURL(/\/papers\/(?!new)[^/]+$/);
    await page.getByLabel("下载格式").selectOption("docx");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载试卷", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("二次函数与图象周测.docx");
    await page.screenshot({ path: info.outputPath("paper-builder.png"), animations: "disabled" });

    await page.goto("/bank");
    const search = page.getByPlaceholder("搜索题干、答案、知识点或来源");
    await search.fill("2025 期末 二次函数");
    const cards = page.locator(".question-card");
    await expect(cards).toHaveCount(3);
    await expect(page.locator(".question-usage")).toHaveCount(2);
    await page.screenshot({ path: info.outputPath("question-bank.png"), animations: "disabled" });
    await page.locator(".bank-more-filters summary").click();
    await page.getByLabel("排除近期用题").selectOption("30");
    await expect(cards).toHaveCount(1);
    await expect(cards.locator(".question-usage")).toHaveCount(0);
  } finally {
    db.close();
  }
});
