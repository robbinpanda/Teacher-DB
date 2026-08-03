import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const dataRoot = path.resolve("data");
const documentStorageRoot = path.resolve(dataRoot, "files", "documents");
assert.ok(documentStorageRoot.startsWith(dataRoot + path.sep));
const db = new Database(path.resolve(dataRoot, "teacher-question-bank.sqlite3"));
const uploadedDocumentIds = new Set(
  db.prepare("SELECT id FROM documents WHERE owner_id LIKE 'runtime-upload-%'").all().map((row) => row.id),
);
db.transaction(() => {
  db.prepare(`DELETE FROM papers WHERE id LIKE 'runtime-smoke-%' OR id IN (
    SELECT pi.paper_id FROM paper_items pi JOIN questions q ON q.id = pi.question_id
    WHERE q.document_id LIKE 'runtime-smoke-%'
  )`).run();
  db.prepare("DELETE FROM documents WHERE id LIKE 'runtime-smoke-%'").run();
  db.prepare("DELETE FROM documents WHERE owner_id LIKE 'runtime-upload-%'").run();
  db.prepare("DELETE FROM app_settings WHERE owner_id LIKE 'runtime-model-%'").run();
  db.prepare("DELETE FROM model_profiles WHERE owner_id LIKE 'runtime-model-%'").run();
  db.prepare("DELETE FROM tags WHERE name = '运行时回归' AND NOT EXISTS (SELECT 1 FROM question_tags WHERE tag_id = tags.id)").run();
})();
db.close();

for (const entry of await readdir(documentStorageRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || (!entry.name.startsWith("runtime-smoke-") && !uploadedDocumentIds.has(entry.name))) continue;
  const target = path.resolve(documentStorageRoot, entry.name);
  assert.ok(target.startsWith(documentStorageRoot + path.sep));
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
console.log("runtime fixtures removed");
