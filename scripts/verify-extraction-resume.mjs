// Disposable database and local fake provider; never calls production models.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
process.env.JIANTI_DATA_DIR = path.resolve('tmp', `extraction-resume-${crypto.randomUUID()}`);
mkdirSync(process.env.JIANTI_DATA_DIR, { recursive: true });
const { ensureDatabase } = await import('../db/bootstrap.ts');
const { getSqlite } = await import('../db/index.ts');
const { putFile } = await import('../lib/file-storage.ts');
const { encryptSecret } = await import('../lib/secret-box.ts');
const { extractDocument } = await import('../server/services/extraction.ts');
const { finalizeDocument } = await import('../server/services/document-finalize.ts');
const { POST: bulkApprove } = await import('../server/http/handlers/documents/bulk/route.ts');
const { PATCH: patchDocument } = await import('../server/http/handlers/documents/[documentId]/route.ts');
const { setExtractionQueuePaused } = await import('../lib/extraction-queue.ts');
const requests = [];
let mode = 'partial';
const question = (number, stem = `真实题干${number}`) => ({ number: String(number), stem, type: 'fill', options: [], answer: '', analysis: '', firstLinePage: 1, assets: [], tags: [], expectedImageCount: 0, missingImages: [], unlocatedImages: false });
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  requests.push(JSON.parse(body));
  const records = [{ event: 'meta', questionCount: 2 }];
  if (mode === 'partial') records.push({ event: 'question', question: question(1) });
  if (mode === 'resume') records.push({ event: 'question', question: question(1, '不应覆盖') }, { event: 'question', question: question(2) }, { event: 'done' });
  if (mode === 'blank') records.push({ event: 'question', question: question(1, '') }, { event: 'done' });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const record of records) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(record) + '\n' } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await ensureDatabase();
  const db = getSqlite(), timestamp = new Date().toISOString();
  const secret = await encryptSecret('fixture');
  db.prepare(`INSERT INTO model_profiles (id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,created_at,updated_at)
    VALUES ('fixture','local-demo','fixture','openai-chat-completions',?,'fixture',?,?,?,?)`)
    .run(`http://127.0.0.1:${server.address().port}/v1`, secret.ciphertext, secret.iv, timestamp, timestamp);
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,created_at,updated_at) VALUES ('d','local-demo','fixture','image/png','extracting',1,?,?)").run(timestamp, timestamp);
  db.prepare("INSERT INTO document_jobs(document_id,owner_id,status,queued_at,updated_at) VALUES ('d','local-demo','queued',?,?)").run(timestamp, timestamp);
  await putFile('d/page.png', await sharp(Buffer.from('<svg width="500" height="500"><rect width="500" height="500" fill="white"/><text x="20" y="50" font-size="28">Question fixture</text></svg>')).png().toBuffer());
  db.prepare("INSERT INTO pages(id,document_id,page_number,storage_key,width,height,created_at) VALUES('p','d',1,'d/page.png',500,500,?)").run(timestamp);
  const input = { documentId: 'd', profileId: 'fixture' };
  const first = await extractDocument('local-demo', input);
  assert.equal(first.status, 502); assert.equal(first.body.retryable, true);
  assert.equal(first.body.savedQuestionCount, 1, JSON.stringify(first.body));
  const saved = db.prepare("SELECT * FROM questions WHERE number='1'").get();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n, 1, 'no placeholder question');
  mode = 'resume';
  const second = await extractDocument('local-demo', input);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.match(JSON.stringify(requests[1]), /从第 2 题开始/);
  assert.deepEqual(db.prepare("SELECT * FROM questions WHERE number='1'").get(), saved, 'durable question unchanged');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n, 2);
  assert.equal((await finalizeDocument('local-demo', 'd')).status, 200);
  const beforeStatus = db.prepare("SELECT status FROM documents WHERE id='d'").get().status;
  const staleFailure = await patchDocument(new Request('http://localhost/api/documents/d', { method: 'PATCH', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'local-demo' }, body: JSON.stringify({ status: 'failed', error: 'stale upload failure' }) }), { params: Promise.resolve({ documentId: 'd' }) });
  assert.equal(staleFailure.status, 409, await staleFailure.text());
  assert.equal(db.prepare("SELECT status FROM documents WHERE id='d'").get().status, beforeStatus);
  // Reproduce historical approved-looking blank content; all admission paths must refuse it.
  db.prepare("UPDATE questions SET stem='' WHERE number='2'").run();
  const blocked = await bulkApprove(new Request('http://localhost/api/documents/bulk', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'local-demo' }, body: JSON.stringify({ action: 'approve_without_review', documentIds: ['d'] }) }));
  assert.equal(blocked.status, 409, await blocked.text());
  db.prepare("UPDATE extraction_runs SET status='queued' WHERE document_id='d'").run();
  mode = 'blank';
  const third = await extractDocument('local-demo', input);
  assert.equal(third.status, 502); assert.equal(third.body.retryable, true);
  assert.equal(db.prepare("SELECT status FROM extraction_runs WHERE document_id='d'").get().status, 'failed');
  db.prepare("UPDATE extraction_runs SET status='paused',error_code='source_only',error='answer attachment' WHERE document_id='d'").run();
  db.prepare("UPDATE document_jobs SET status='paused',last_error='answer attachment' WHERE document_id='d'").run();
  db.prepare("UPDATE documents SET status='failed',error='answer attachment' WHERE id='d'").run();
  await setExtractionQueuePaused('local-demo', true);
  await setExtractionQueuePaused('local-demo', false);
  assert.equal(db.prepare("SELECT status FROM documents WHERE id='d'").get().status, 'failed');
  assert.equal(db.prepare("SELECT status FROM document_jobs WHERE document_id='d'").get().status, 'paused');
  assert.equal(db.prepare("SELECT error_code FROM extraction_runs WHERE document_id='d'").get().error_code, 'source_only');
  console.log(JSON.stringify({ ok: true, verified: ['partial result retained', 'resume from question 2', 'prefix immutable', 'stale upload failure blocked', 'blank result retryable', 'blank admission blocked', 'answer attachments excluded from pause/resume'] }));
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  getSqlite().close();
}
