import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the teacher question-bank workflow", async () => {
  const [home, upload, review, bank, paper] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/UploadWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ReviewWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/QuestionBank.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/PaperBuilder.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /上传一份新试卷|UploadWorkbench/);
  assert.match(upload, /renderPdf/);
  assert.match(upload, /renderDocx/);
  assert.match(review, /beginDrag/);
  assert.match(bank, /选中组卷/);
  assert.match(paper, /window\.print/);
});

test("ships persistence schema and no starter preview", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /documents/);
  assert.match(schema, /question_assets/);
  assert.match(schema, /paper_items/);
  await access(new URL("../drizzle/0000_lean_songbird.sql", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
