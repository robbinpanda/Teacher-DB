import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { computePageSlices } from "../lib/page-slices.mjs";

test("splits continuous DOCX output into stable page ranges", () => {
  const slices = computePageSlices(25174, 1628, [1500, 3200, 4800, 6500]);
  assert.equal(slices.length, 16);
  assert.equal(slices[0].start, 0);
  assert.equal(slices.reduce((sum, slice) => sum + slice.height, 0), 25174);
  assert.ok(slices.every((slice) => slice.height > 0 && slice.height <= 1800));
});

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
  assert.match(upload, /computePageSlices/);
  assert.match(upload, /waiting_model/);
  assert.match(review, /beginDrag/);
  assert.match(bank, /选中组卷/);
  assert.match(paper, /\/api\/papers\/.*\/pdf/);
});

test("ships Node SQLite persistence and disables model reasoning", async () => {
  const [schema, extraction, vision, database, packageJson, pageUpload, pdfExport, modelTest, modelProfiles] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/extract/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/vision-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/documents/[documentId]/pages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pdf-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/model-profiles/test/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/model-profiles.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /documents/);
  assert.match(schema, /question_assets/);
  assert.match(schema, /paper_items/);
  assert.match(extraction, /sqliteTransaction/);
  assert.match(extraction, /answerUpdates/);
  assert.match(extraction, /getFile\(ownedPage\.storageKey\)/);
  assert.match(vision, /reasoning_effort:\s*"none"/);
  assert.match(vision, /invalid thinking/);
  assert.match(database, /better-sqlite3/);
  assert.match(packageJson, /"dev":\s*"next dev"/);
  assert.match(pageUpload, /'queued'/);
  assert.match(pdfExport, /--print-to-pdf/);
  assert.match(modelTest, /width:\s*64/);
  assert.doesNotMatch(modelTest, /AAAAEAAAAB/);
  assert.match(modelProfiles, /OPENCODE_PUBLIC_API_KEY\s*=\s*"public"/);
  assert.match(modelProfiles, /encryptSecret\(OPENCODE_PUBLIC_API_KEY\)/);
  await access(new URL("../drizzle/0000_lean_songbird.sql", import.meta.url));
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
});
