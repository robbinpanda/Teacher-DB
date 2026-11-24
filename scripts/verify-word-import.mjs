// End-to-end check of Word import without a model: real processor, API and worker.
// Upload .docx -> processor reads formulas/images -> typeset to PDF -> pages saved -> awaiting model.
// Set WORD_VERIFY_FILE to a real paper to run it instead of the generated fixture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { preparePython } from "./python-runtime.mjs";
import { stopIsolatedProcess } from "./test-runtime.mjs";

const root = process.cwd();
const tmpRoot = path.resolve("tmp");
const dataDir = path.join(tmpRoot, `word-import-verify-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const children = [];
const token = crypto.randomUUID() + crypto.randomUUID();
const apiPort = Number(process.env.WORD_VERIFY_API_PORT || 3193);
const processorPort = Number(process.env.WORD_VERIFY_PROCESSOR_PORT || 3293);
const env = { ...process.env, JIANTI_DATA_DIR: dataDir, JIANTI_DEPLOYMENT_MODE: "local", JIANTI_API_PORT: String(apiPort),
  JIANTI_DOCUMENT_PROCESSOR_URL: `http://127.0.0.1:${processorPort}`, JIANTI_PROCESSOR_TOKEN: token };
let logs = "";
let db;
function start(command, args) {
  const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", bytes => { logs += bytes; }); child.stderr.on("data", bytes => { logs += bytes; });
  children.push(child); return child;
}
function node(entry) { return start(process.execPath, ["--import", "./server/register.mjs", "--import", "tsx", entry]); }
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out\n${logs.slice(-4000)}`);
}

const FIXTURE = String.raw`
import io, sys, zipfile
from PIL import Image
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
frac = '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>𝑥</m:t></m:r></m:den></m:f><m:r><m:t>&gt;0</m:t></m:r></m:oMath>'
pic = '<w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="952500"/><a:graphic><a:graphicData uri="pic"><a:blip r:embed="rImg"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
body = ''.join([
  '<w:p><w:r><w:t>一、选择题</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>1．不等式</w:t></w:r>' + frac + '<w:r><w:t>的解集为（　　）</w:t></w:r></w:p>',
  '<w:p><w:r><w:t xml:space="preserve">A．x&gt;0    B．x&lt;0    C．x≠0    D．R</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>2．如图，求阴影部分面积。</w:t></w:r></w:p><w:p>' + pic + '</w:p>',
])
buffer = io.BytesIO(); Image.new('RGB', (200, 150), 'white').save(buffer, format='PNG')
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('[Content_Types].xml', '<Types/>')
    z.writestr('word/document.xml', '<w:document ' + W + '><w:body>' + body + '</w:body></w:document>')
    z.writestr('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImg" Type="x" Target="media/image1.png"/></Relationships>')
    z.writestr('word/media/image1.png', buffer.getvalue())
`;

try {
  const python = await preparePython(root);
  const docxPath = process.env.WORD_VERIFY_FILE ? path.resolve(process.env.WORD_VERIFY_FILE) : path.join(dataDir, "fixture.docx");
  if (!process.env.WORD_VERIFY_FILE) {
    const generator = start(python, ["-c", FIXTURE, docxPath]);
    assert.equal((await once(generator, "exit"))[0], 0, logs);
  }
  start(python, ["-m", "uvicorn", "processor.main:app", "--host", "127.0.0.1", "--port", String(processorPort)]);
  node("server/main.ts");
  await until(async () => (await fetch(`http://127.0.0.1:${processorPort}/ready`)).ok && (await fetch(`http://127.0.0.1:${apiPort}/api/ready`)).ok);
  const upload = (name, bytes) => {
    const form = new FormData(); form.set("file", new File([bytes], name)); form.set("pageCount", "0");
    return fetch(`http://127.0.0.1:${apiPort}/api/documents`, { method: "POST", body: form });
  };
  assert.equal((await upload("old.doc", Buffer.from("not docx"))).status, 415);
  assert.equal((await upload("fake.docx", Buffer.from("%PDF-1.7"))).status, 415);
  const uploaded = await upload(path.basename(docxPath), readFileSync(docxPath));
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const document = await uploaded.json();
  assert.equal(document.preparationQueued, true);
  db = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  const started = Date.now();
  node("server/worker.ts");
  await until(async () => ["complete", "failed"].includes(db.prepare("SELECT status FROM document_preparations WHERE document_id=?").get(document.id)?.status), 240000);
  const preparation = db.prepare("SELECT * FROM document_preparations WHERE document_id=?").get(document.id);
  assert.equal(preparation.status, "complete", preparation.last_error ?? logs.slice(-3000));
  const row = db.prepare("SELECT status, mime_type AS mimeType, page_count AS pageCount FROM documents WHERE id=?").get(document.id);
  assert.equal(row.mimeType, path.extname(docxPath).toLowerCase() === ".doc" ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(row.status, "awaiting_model");
  assert.ok(row.pageCount >= 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pages WHERE document_id=?").get(document.id).n, row.pageCount);
  const wordDir = path.join(dataDir, "files", "documents", document.id, "word");
  const storageRoot = existsSync(wordDir) ? wordDir : path.join(dataDir, "documents", document.id, "word");
  for (const name of ["parsed.json", "report.json", "rendered.pdf"]) assert.ok(existsSync(path.join(storageRoot, name)), `missing ${name} in ${storageRoot}`);
  const report = JSON.parse(readFileSync(path.join(storageRoot, "report.json"), "utf8"));
  if (!process.env.WORD_VERIFY_FILE) assert.deepEqual({ formulas: report.formulas, review: report.reviewFormulas, images: report.images }, { formulas: 1, review: 0, images: 1 });
  console.log(`word import: ok (${path.basename(docxPath)}: ${row.pageCount} pages in ${((Date.now() - started) / 1000).toFixed(1)}s; formulas ${report.formulas} [MathType ${report.mathtype}, Word ${report.omml}], review ${report.reviewFormulas}, images ${report.images}; rejects fake .doc and .docx)`);
} finally {
  db?.close(); await Promise.all(children.map(child => child.exitCode === null && child.signalCode === null ? stopIsolatedProcess(child) : undefined));
  assert.ok(dataDir.startsWith(tmpRoot + path.sep)); rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
