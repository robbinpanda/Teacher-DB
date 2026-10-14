// Isolated database and mocked model: no production writes or external requests.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
process.env.JIANTI_DATA_DIR = path.resolve('tmp', `document-naming-${crypto.randomUUID()}`);
process.env.JIANTI_DEPLOYMENT_MODE = 'local';
delete process.env.JIANTI_DOCUMENT_PROCESSOR_URL;
mkdirSync(process.env.JIANTI_DATA_DIR, { recursive: true });
const { POST: createProfile } = await import('../server/http/handlers/model-profiles/route.ts');
const { uploadDocument } = await import('../server/services/document-upload.ts');
const { getSqlite } = await import('../db/index.ts');
const { getFile } = await import('../lib/file-storage.ts');
const owner = 'naming-fixture';
async function profile(model, service, profileOwner = owner) {
  const response = await createProfile(new Request('http://localhost/api/model-profiles', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': profileOwner }, body: JSON.stringify({ model, service, apiKey: 'fixture-key', select: true }) }));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).profile;
}
await profile('mimo-v2.6-flash', 'opencode-go');
const extraction = await profile('deepseek-v4.1-flash', 'opencode-go');
let calls = 0, mode = 'valid';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  calls++;
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'mimo-v2.6-flash');
  assert.ok(!JSON.stringify(body.messages).includes('image_url'));
  assert.ok(JSON.stringify(body.messages).includes('2025年上海市嘉定区一模.pdf'));
  if (mode === 'failure') return new Response('temporary outage', { status: 503 });
  const content = mode === 'invalid' ? 'not json' : JSON.stringify({ kind: 'mock', year: '2025', exam: '一模', region: '上海市嘉定区', school: '', qualifier: '' });
  return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
};
function form(content = '%PDF-1.4\nfixture', pages = '0') {
  const data = new FormData(); data.set('file', new File([content], '2025年上海市嘉定区一模.pdf', { type: 'application/pdf' })); data.set('pageCount', pages); return data;
}
try {
  const first = await uploadDocument(owner, form());
  assert.equal(first.status, 201); assert.equal(first.body.name, '2025年一模上海市嘉定区');
  const db = getSqlite();
  assert.equal(db.prepare('SELECT name FROM documents WHERE id=?').get(first.body.id).name, first.body.name);
  assert.equal(Buffer.from(await getFile(first.body.originalKey)).toString(), '%PDF-1.4\nfixture');
  const duplicate = await uploadDocument(owner, form(undefined, '2'));
  assert.equal(duplicate.body.id, first.body.id); assert.equal(calls, 1, 'page registration must not repeat naming');
  assert.equal(db.prepare('SELECT name FROM documents WHERE id=?').get(first.body.id).name, first.body.name);
  assert.equal(db.prepare('SELECT selected_model_profile_id id FROM app_settings WHERE owner_id=?').get(owner).id, extraction.id);
  for (const failure of ['failure', 'invalid']) {
    mode = failure; const result = await uploadDocument(owner, form('%PDF-1.4\n' + failure));
    assert.equal(result.status, 201); assert.equal(result.body.name, '2025年上海市嘉定区一模.pdf'); assert.ok(result.body.namingWarning);
  }
  const before = calls;
  const isolated = await uploadDocument('other-owner', form());
  assert.equal(isolated.status, 201); assert.ok(isolated.body.namingWarning); assert.equal(calls, before, 'must not borrow credentials from another owner');
  console.log(JSON.stringify({ passed: true, modelCalls: calls, duplicateCalls: 0, failurePreservesPdf: true, ownerIsolation: true }));
} finally { globalThis.fetch = originalFetch; getSqlite().close(); }
