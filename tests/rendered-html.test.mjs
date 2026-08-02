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
  assert.match(paper, /\/api\/papers\/.*\/pdf/);
});

test("ships Node SQLite persistence and disables model reasoning", async () => {
  const [schema, extraction, vision, database, packageJson, pageUpload, pdfExport] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/extract/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/vision-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/documents/[documentId]/pages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pdf-export.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /documents/);
  assert.match(schema, /question_assets/);
  assert.match(schema, /paper_items/);
  assert.match(extraction, /sqliteTransaction/);
  assert.match(extraction, /answerUpdates/);
  assert.match(extraction, /getFile\(ownedPage\.storageKey\)/);
  assert.match(vision, /reasoning_effort:\s*"none"/);
  assert.match(database, /better-sqlite3/);
  assert.match(packageJson, /"dev":\s*"next dev"/);
  assert.match(pageUpload, /'queued'/);
  assert.match(pdfExport, /--print-to-pdf/);
  await access(new URL("../drizzle/0000_lean_songbird.sql", import.meta.url));
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
});
