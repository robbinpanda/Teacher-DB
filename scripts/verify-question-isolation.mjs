// Run: node --import ./server/register.mjs --import tsx scripts/verify-question-isolation.mjs
// Only a local fake provider and a new isolated database are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

process.env.JIANTI_DATA_DIR = path.resolve("tmp", `question-isolation-${crypto.randomUUID()}`);
mkdirSync(process.env.JIANTI_DATA_DIR, { recursive: true });
const { ensureDatabase } = await import("../db/bootstrap.ts");
const { getSqlite } = await import("../db/index.ts");
const { putFile } = await import("../lib/file-storage.ts");
const { encryptSecret } = await import("../lib/secret-box.ts");
const { extractDocument } = await import("../server/services/extraction.ts");
const { finalizeDocument } = await import("../server/services/document-finalize.ts");
const { saveQuestion } = await import("../server/services/question-review.ts");
let output = "", calls = 0;
const server = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  calls++;
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (let i = 0; i < output.length; i += 11) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: output.slice(i, i + 11) } }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  await ensureDatabase();
  const db = getSqlite(), timestamp = new Date().toISOString();
  const secret = await encryptSecret("local-fixture-only");
  db.prepare(`INSERT INTO model_profiles (id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,created_at,updated_at)
    VALUES ('fixture','local-demo','fixture','openai-chat-completions',?,'fixture',?,?,?,?)`)
    .run(`http://127.0.0.1:${server.address().port}/v1`, secret.ciphertext, secret.iv, timestamp, timestamp);
  const page = await sharp({ create: { width: 500, height: 500, channels: 3, background: "white" } }).png().toBuffer();
  const rawQuestion = number => ({ event: "question", question: { number: String(number), type: "fill", stem: `原卷第${number}题`, answer: "2", analysis: "解析", firstLinePage: 1, assets: [], expectedImageCount: 0, missingImages: [], unlocatedImages: false, confidence: 0.9, needsHumanReview: false, tags: [] } });
  async function run(id, records, count = 3, seed = () => {}) {
    db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,created_at,updated_at) VALUES (?,'local-demo','fixture','image/png','extracting',1,?,?)").run(id, timestamp, timestamp);
    await putFile(`${id}/page.png`, page);
    db.prepare("INSERT INTO pages (id,document_id,page_number,storage_key,width,height,created_at) VALUES (?,?,1,?,500,500,?)").run(`${id}-p`, id, `${id}/page.png`, timestamp);
    seed();
    output = [JSON.stringify({ event: "meta", questionCount: count }), ...records, '{"event":"done"}', '{"event":"done"}', JSON.stringify({ event: "meta", questionCount: 999 })].join("\n");
    const extracted = await extractDocument("local-demo", { documentId: id, profileId: "fixture" });
    assert.equal(extracted.status, 200, JSON.stringify(extracted.body));
    const finalized = await finalizeDocument("local-demo", id);
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
    assert.equal(db.prepare("SELECT status FROM documents WHERE id=?").get(id).status, "reviewing");
    return extracted.body.questions;
  }
  const questions = await run("broken", [JSON.stringify(rawQuestion(1)), '{"event":"question","question":{"number":"2","stem": broken}}', JSON.stringify(rawQuestion(3))]);
  assert.equal(questions.length, 3); assert.equal(questions[0].stem, "原卷第1题"); assert.equal(questions[2].stem, "原卷第3题");
  const bad = questions.find(q => q.number === "2"), good = questions.find(q => q.number === "3");
  assert.equal(bad.stem, ""); assert.ok(bad.extractionIssues[0].raw.includes("broken"));
  const approved = await saveQuestion("local-demo", good.id, { ...good, status: "approved", needsHumanReview: false });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const blocked = await saveQuestion("local-demo", bad.id, { ...bad, stem: "人工补录", status: "approved", needsHumanReview: false });
  assert.equal(blocked.status, 409); assert.match(blocked.body.error, /识别异常/);
  const repaired = await saveQuestion("local-demo", bad.id, { ...bad, stem: "人工补录", status: "approved", needsHumanReview: false, extractionIssuesResolved: true });
  assert.equal(repaired.status, 200, JSON.stringify(repaired.body));
  assert.deepEqual(repaired.body.question.extractionIssues, []);
  const audit = JSON.parse(db.prepare("SELECT raw_json FROM extraction_runs WHERE document_id='broken'").get().raw_json);
  assert.ok(audit.questions.find(q => q.number === "2")._extractionIssues[0].raw.includes("broken"));
  const before = calls;
  assert.equal((await extractDocument("local-demo", { documentId: "broken", profileId: "fixture" })).status, 200);
  assert.equal(calls, before, "complete run must replay without another model call");

  const missing = await run("missing", [JSON.stringify(rawQuestion(1)), JSON.stringify(rawQuestion(3))]);
  assert.equal(missing.find(q => q.number === "2").status, "needs_attention");
  const recovered = await run("recovered", [JSON.stringify(rawQuestion(1)), JSON.stringify(rawQuestion(2)).slice(0, -1), JSON.stringify(rawQuestion(3))]);
  assert.equal(recovered[1].stem, "原卷第2题"); assert.equal(recovered[1].extractionIssues[0].code, "repaired_json");
  assert.equal(recovered[2].status, "pending");
  await run("retained", [JSON.stringify(rawQuestion(1)), JSON.stringify(rawQuestion(3))], 3, () => {
    for (const [number, status, stem] of [[1, "approved", "教师已审核"], [2, "pending", "已有草稿"], [4, "pending", "既有额外题目"]]) {
      db.prepare(`INSERT INTO questions (id,document_id,number,type,stem,page_number,bbox_json,status,needs_human_review,created_at,updated_at)
        VALUES (?,'retained',?,'fill',?,1,'{}',?,0,?,?)`).run(`retained-${number}`, String(number), stem, status, timestamp, timestamp);
    }
  });
  assert.equal(db.prepare("SELECT stem FROM questions WHERE id='retained-1'").get().stem, "教师已审核");
  assert.equal(db.prepare("SELECT status FROM questions WHERE id='retained-1'").get().status, "approved");
  assert.equal(db.prepare("SELECT stem FROM questions WHERE id='retained-2'").get().stem, "已有草稿");
  assert.equal(db.prepare("SELECT status FROM questions WHERE id='retained-2'").get().status, "needs_attention");
  assert.equal(db.prepare("SELECT stem FROM questions WHERE id='retained-4'").get().stem, "既有额外题目");
  console.log("PASS: isolated extraction → finalize → per-question approval; raw audit preserved; missing/repaired questions; duplicate footer; idempotency");
} finally {
  await new Promise(resolve => server.close(resolve));
  getSqlite().close();
}
