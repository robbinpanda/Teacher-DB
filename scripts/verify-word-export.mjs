// End-to-end check of the Word paper export against an isolated API server:
// a saved paper with formulas, options and a figure downloads as a .docx whose
// document part carries native equations and the embedded picture.
//
//   node --experimental-strip-types scripts/verify-word-export.mjs
//   node --experimental-strip-types scripts/verify-word-export.mjs --open-in-word   (Windows with Word installed)
//
// Uses port 3291 and a temporary data directory; no model is called.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import Database from "better-sqlite3";
import sharp from "sharp";
import { resolveFileStorageKey } from "../lib/storage-path.ts";
import { stopIsolatedProcess } from "./test-runtime.mjs";

const dataDir = path.resolve("tmp", `word-export-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const port = process.env.WORD_VERIFY_API_PORT ?? "3291";
const base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["--import", "./server/register.mjs", "--import", "tsx", "server/main.ts"], {
  env: { ...process.env, JIANTI_DATA_DIR: dataDir, JIANTI_API_PORT: port, JIANTI_DEPLOYMENT_MODE: "local" },
  stdio: "ignore", windowsHide: true,
});

function documentXml(bytes) {
  const buffer = Buffer.from(bytes);
  let offset = buffer.readUInt32LE(buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16);
  for (;;) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "word/document.xml is in the archive");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === "word/document.xml") {
      const local = buffer.readUInt32LE(offset + 42);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + buffer.readUInt32LE(offset + 20));
      return (buffer.readUInt16LE(offset + 10) === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 150 && !ready; attempt++) {
    try { ready = (await fetch(`${base}/api/health`)).ok; } catch { /* still starting */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, "isolated API server ready");

  const cropKey = "documents/word-doc/crops/figure.webp";
  const cropPath = resolveFileStorageKey(dataDir, cropKey);
  mkdirSync(path.dirname(cropPath), { recursive: true });
  // WebP on purpose: Word cannot embed it, so the export has to re-encode.
  writeFileSync(cropPath, await sharp({ create: { width: 320, height: 200, channels: 3, background: "#cfe3d8" } }).webp().toBuffer());

  const db = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  const at = new Date().toISOString();
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,subject,grade,created_at,updated_at) VALUES ('word-doc','local-demo','Word 导出样卷','application/pdf','complete',1,'数学','高一',?,?)").run(at, at);
  const insert = db.prepare("INSERT INTO questions (id,document_id,number,type,stem,options_json,answer,analysis,page_number,bbox_json,status,needs_human_review,confidence,score,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,'{}','approved',0,1,5,?,?)");
  const questions = [
    ["word-q1", "single", "已知 $\\vec{a}\\perp\\vec{b}$，$|\\vec{a}|=\\dfrac{\\sqrt{3}}{2}$，则 $\\vec{a}\\cdot(\\vec{a}+\\vec{b})$ 等于",
      JSON.stringify([{ key: "A", content: "$\\dfrac{3}{4}$" }, { key: "B", content: "$\\dfrac{1}{2}$" }, { key: "C", content: "$1$" }, { key: "D", content: "$\\sqrt{3}$" }]),
      "A", "由 $\\vec{a}\\cdot\\vec{b}=0$ 得 $\\vec{a}^2=\\dfrac{3}{4}$."],
    ["word-q2", "fill", "函数 $f(x)=\\begin{cases}x^2, & x\\ge 0\\\\ -x, & x<0\\end{cases}$ 的最小值为 $\\underline{\\hspace{2em}}$.", null, "$0$", "分段讨论."],
    ["word-q3", "answer", "在 $\\triangle ABC$ 中，$\\overrightarrow{AB}\\cdot\\overrightarrow{AC}=2$.\n（1）求 $\\cos A$；\n（2）证明：$$\\begin{aligned}a^2&=b^2+c^2-2bc\\cos A\\\\&\\ge 2bc-4\\end{aligned}$$", null, "略", "略"],
  ];
  questions.forEach(([id, type, stem, options, answer, analysis], index) => insert.run(id, "word-doc", String(index + 1), type, stem, options, answer, analysis, at, at));
  db.prepare("INSERT INTO question_assets (id,question_id,kind,role,label,crop_key,bbox_json,position,created_at) VALUES ('word-asset','word-q3','figure','question','题图',?,'{}',0,?)").run(cropKey, at);
  db.prepare("INSERT INTO papers (id,owner_id,title,subtitle,settings_json,created_at,updated_at) VALUES ('word-paper','local-demo','Word 导出验证卷','高一数学','{}',?,?)").run(at, at);
  questions.forEach(([id], index) => db.prepare("INSERT INTO paper_items (paper_id,question_id,position,score) VALUES ('word-paper',?,?,5)").run(id, index));
  db.close();

  const student = await fetch(`${base}/api/papers/word-paper/docx`);
  assert.equal(student.status, 200);
  assert.equal(student.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.match(student.headers.get("content-disposition") ?? "", /\.docx/);
  assert.equal(student.headers.get("x-jianti-unconverted-formulas"), "");
  assert.equal(student.headers.get("x-jianti-missing-images"), "");
  const studentBytes = Buffer.from(await student.arrayBuffer());
  const xml = documentXml(studentBytes);
  assert.equal((xml.match(/<m:oMath[ >]/g) ?? []).length, 12, "every formula is a native equation");
  assert.match(xml, /<m:begChr m:val="\{"\/>/, "piecewise brace is a growing delimiter");
  assert.match(xml, /<m:eqArr>/, "aligned derivation keeps its alignment");
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 1, "figure embedded");
  assert.equal((xml.match(/<w:tab\/>/g) ?? []).length, 3, "four options share one tab-aligned line");
  assert.doesNotMatch(xml, /答案：/);
  assert.doesNotMatch(xml, /\$/, "no raw LaTeX left in the document");

  const teacher = await fetch(`${base}/api/papers/word-paper/docx?answers=1`);
  assert.equal(teacher.status, 200);
  const teacherBytes = Buffer.from(await teacher.arrayBuffer());
  assert.match(documentXml(teacherBytes), /答案：.*解析：/s);

  assert.equal((await fetch(`${base}/api/papers/missing/docx`)).status, 404);
  assert.equal((await fetch(`${base}/api/papers/word-paper/docx`, { headers: { "oai-authenticated-user-id": "other-teacher" } })).status, 404, "another teacher cannot export this paper");

  if (process.argv.includes("--open-in-word")) {
    assert.equal(process.platform, "win32", "--open-in-word needs Windows with Word installed");
    const output = path.resolve("tmp", "word-export-check");
    mkdirSync(output, { recursive: true });
    for (const [name, bytes, equations] of [["student", studentBytes, 12], ["answers", teacherBytes, 15]]) {
      const file = path.join(output, `${name}.docx`);
      writeFileSync(file, bytes);
      const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("scripts", "word-open-check.ps1"), "-Source", file, "-Target", path.join(output, `${name}.pdf`)], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(`equations=${equations}\\b`), `Word recognises ${equations} equations in ${name}.docx: ${result.stdout}`);
    }
    console.log(`Word opened both files; PDFs for visual review are in ${output}`);
  }
  console.log("Word export verified");
} finally {
  await stopIsolatedProcess(child);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
