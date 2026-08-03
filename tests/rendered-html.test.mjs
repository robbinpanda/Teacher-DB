import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the teacher question-bank workflow", async () => {
  const [home, upload, review, bank, paper, documentsApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/UploadWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ReviewWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/QuestionBank.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/PaperBuilder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/documents/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(home, /上传一份新试卷|UploadWorkbench/);
  assert.match(upload, /renderPdf/);
  assert.match(upload, /waiting_model/);
  assert.match(upload, /multiple type="file"/);
  assert.match(upload, /accept="\.pdf,application\/pdf"/);
  assert.match(upload, /mapWithConcurrency\(queued, 2/);
  assert.match(upload, /pageCount", "0"/);
  assert.match(review, /cross-page-regions/);
  assert.match(documentsApi, /acceptedExtensions = \["\.pdf"\]/);
  assert.match(documentsApi, /decode\(bytes\.slice\(0, 5\)\) !== "%PDF-"/);
  assert.doesNotMatch(upload, /renderDocx|docx-preview|\/api\/office\/render/);
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
  assert.match(schema, /question_regions/);
  assert.match(schema, /paper_items/);
  assert.match(extraction, /sqliteTransaction/);
  assert.match(extraction, /answerUpdates/);
  assert.match(extraction, /getFile\(sourcePage\.storageKey\)/);
  assert.match(extraction, /rawRegions = Array\.isArray\(item\.regions\)/);
  assert.match(extraction, /INSERT INTO question_regions/);
  assert.match(extraction, /const sourcePages = \[ownedPage/);
  assert.match(extraction, /images: modelImages/);
  assert.match(extraction, /containsBox/);
  assert.match(extraction, /assetGeometryNeedsReview/);
  assert.match(vision, /reasoning_effort:\s*"none"/);
  assert.match(vision, /invalid thinking/);
  assert.match(database, /better-sqlite3/);
  assert.match(packageJson, /"dev":\s*"next dev -p 3050"/);
  assert.match(packageJson, /"start":\s*"next start -p 3050"/);
  assert.match(packageJson, /"start:test":\s*"next start -p 8050"/);
  assert.doesNotMatch(packageJson, /-p (?:3000|8010)/);
  assert.match(pageUpload, /'queued'/);
  assert.match(pdfExport, /--print-to-pdf/);
  assert.match(modelTest, /width:\s*64/);
  assert.doesNotMatch(modelTest, /AAAAEAAAAB/);
  assert.match(modelProfiles, /OPENCODE_PUBLIC_API_KEY\s*=\s*"public"/);
  assert.match(modelProfiles, /encryptSecret\(OPENCODE_PUBLIC_API_KEY\)/);
  await access(new URL("../drizzle/0000_lean_songbird.sql", import.meta.url));
  await assert.rejects(access(new URL("../.openai/hosting.json", import.meta.url)));
});
