// Isolated database and in-process HTTP mock: never calls an external model.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
process.env.JIANTI_DATA_DIR = path.resolve('tmp', `model-services-${crypto.randomUUID()}`);
process.env.JIANTI_DEPLOYMENT_MODE = 'local';
mkdirSync(process.env.JIANTI_DATA_DIR, { recursive: true });
const { POST, GET } = await import('../server/http/handlers/model-profiles/route.ts');
const { PUT } = await import('../server/http/handlers/model-profiles/[profileId]/route.ts');
const { POST: testConnection } = await import('../server/http/handlers/model-profiles/test/route.ts');
const { callTextModel } = await import('../lib/text-model.ts');
const { callVisionModel, callVisionModelStream } = await import('../lib/vision-model.ts');
const { getSqlite } = await import('../db/index.ts');
const http = (body, method = 'POST', owner = 'fixture-owner') => new Request('http://localhost/api/model-profiles', {
  method, headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': owner }, body: JSON.stringify(body) });
const requests = []; let rejectNext = false;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (endpoint, init) => {
  const body = JSON.parse(init.body); const headers = new Headers(init.headers);
  requests.push({ endpoint, body, headers });
  assert.ok(/^https:\/\/(opencode.ai|openrouter.ai|custom.example)\//.test(endpoint), 'unexpected network target');
  if (rejectNext) { rejectNext = false; return new Response('unsupported formatting', { status: 400 }); }
  const text = '{"ok":true,"text":"TEST 42"}';
  const google = endpoint.includes('/models/'); const anthropic = endpoint.endsWith('/messages'); const responses = endpoint.endsWith('/responses');
  const result = google ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } }
    : anthropic ? { content: [{ type: 'text', text }], usage: { input_tokens: 20, output_tokens: 10 } }
    : responses ? { output_text: text, usage: { input_tokens: 20, output_tokens: 10 } }
    : { choices: [{ message: { content: text } }], usage: { prompt_tokens: 20, completion_tokens: 10 } };
  if (body.stream || endpoint.includes(':streamGenerateContent')) {
    const events = google ? [result] : anthropic ? [{ type: 'content_block_delta', delta: { type: 'text_delta', text } }, { type: 'message_delta', usage: result.usage }]
      : responses ? [{ type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: result }]
      : [{ choices: [{ delta: { content: text } }], usage: result.usage }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }
  return Response.json(result);
};
try {
  const profiles = [];
  for (const [service, model] of [
    ...['gpt-6-luna', 'claude-haiku-5-5', 'mimo-v2.6-flash-free', 'deepseek-v4.1-flash'].map(model => ['opencode', model]),
    ...['gpt-6-luna', 'claude-haiku-5-5', 'mimo-v2.6-flash', 'deepseek-v4.1-flash'].map(model => ['opencode-go', model]),
  ]) {
    const response = await POST(http({ service, model, apiKey: 'fixture-secret', baseUrl: 'https://evil.example/v1', provider: 'wrong' }));
    assert.equal(response.status, 201, await response.clone().text());
    const { profile } = await response.json(); profiles.push(profile);
    assert.equal(profile.service, service);
    if (service === 'opencode-go') assert.equal(profile.baseUrl, 'https://opencode.ai/inference/go/v1'); assert.match(profile.baseUrl, /^https:\/\/opencode.ai\/inference\//);
    assert.ok(!JSON.stringify(profile).includes('fixture-secret')); assert.equal(profile.apiKeyCiphertext, undefined);
    const input = { ownerId: 'fixture-owner', profileId: profile.id, system: 'system', text: 'question', images: [{ page: 1, dataUrl: 'data:image/png;base64,AAAA' }] };
    const before = requests.length; rejectNext = true;
    const text = await callTextModel({ ...input, purpose: 'fixture', jsonMode: true });
    assert.equal(JSON.parse(text.content).ok, true);
    assert.equal(requests[before].headers.get('x-opencode-session'), requests[before + 1].headers.get('x-opencode-session'));
    const textSession = requests[before].headers.get('x-opencode-session'); assert.ok(textSession);
    await callVisionModel({ ...input, purpose: 'question_review' });
    assert.notEqual(requests.at(-1).headers.get('x-opencode-session'), textSession);
    let streamed = ''; rejectNext = true;
    await callVisionModelStream({ ...input, purpose: 'page_extraction', extractionRunId: 'fixture-run' }, { onTextDelta: delta => { streamed += delta; } });
    assert.equal(JSON.parse(streamed).ok, true);
    assert.equal(requests.at(-1).headers.get('x-opencode-session'), 'fixture-run');
    assert.equal(requests.at(-2).headers.get('x-opencode-session'), 'fixture-run');
    const test = await testConnection(http({ profileId: profile.id })); assert.equal(test.status, 200, await test.clone().text());
    for (const req of requests.slice(before)) assert.equal(new URL(req.endpoint).pathname.startsWith('/inference/go/'), service === 'opencode-go');
  }
  const profile = profiles[0]; const context = { params: Promise.resolve({ profileId: profile.id }) };
  assert.equal((await PUT(http({ model: 'gpt-6-luna' }, 'PUT', 'wrong-owner'), context)).status, 404);
  const update = await PUT(http({ model: 'claude-haiku-5-5' }, 'PUT'), context);
  assert.equal(update.status, 200, await update.clone().text());
  assert.equal((await update.json()).profile.provider, 'anthropic-messages');
  assert.equal((await PUT(http({ service: 'openrouter' }, 'PUT'), context)).status, 400);
  assert.equal((await PUT(http({ service: 'opencode-go' }, 'PUT'), context)).status, 400);
  const switched = await PUT(http({ service: 'opencode-go', model: 'mimo-v2.6-flash', apiKey: 'fixture-go' }, 'PUT'), context);
  assert.equal(switched.status, 200, await switched.clone().text());
  const switchedProfile = (await switched.json()).profile;
  assert.equal(switchedProfile.service, 'opencode-go');
  assert.equal(switchedProfile.baseUrl, 'https://opencode.ai/inference/go/v1');
  const editedGo = await PUT(http({ model: 'claude-haiku-5-5' }, 'PUT'), context);
  assert.equal(editedGo.status, 200);
  assert.equal((await editedGo.json()).profile.provider, 'anthropic-messages');
  for (const service of ['openrouter', 'custom']) {
    const response = await POST(http({ service, displayName: service, model: 'xiaomi/mimo-v2.6-flash', apiKey: 'fixture-other', baseUrl: 'https://custom.example/v1' }));
    assert.equal(response.status, 201, await response.clone().text());
    const { profile: other } = await response.json();
    await callTextModel({ ownerId: 'fixture-owner', profileId: other.id, system: 'system', text: 'test', purpose: 'fixture' });
    assert.equal(requests.at(-1).headers.get('x-opencode-session'), null);
    assert.equal(requests.at(-1).headers.get('user-agent'), null);
    assert.match(requests.at(-1).endpoint, service === 'openrouter' ? /^https:\/\/openrouter.ai\/api\/v1\/chat\/completions$/ : /^https:\/\/custom.example\/v1\/chat\/completions$/);
  }
  const list = await GET(new Request('http://localhost', { headers: { 'oai-authenticated-user-id': 'fixture-owner' } }));
  assert.ok(!(await list.text()).includes('fixture-secret'));
  assert.equal((await POST(http({ service: 'opencode', model: 'unknown', apiKey: 'key' }))).status, 400);
  assert.equal((await POST(http({ service: 'invalid', model: 'model', apiKey: 'key' }))).status, 400);
  assert.ok(getSqlite().prepare('SELECT count(*) AS n FROM model_usage_events').get().n >= 16);
  const geminiResponse = await POST(http({ service: 'custom', displayName: 'Gemini fixture', model: 'gemini-3.1-pro', apiKey: 'fixture-secret', provider: 'google-generate-content', baseUrl: 'https://custom.example/v1beta' }));
  assert.equal(geminiResponse.status, 201);
  const { profile: geminiProfile } = await geminiResponse.json();
  await callVisionModel({ ownerId: 'fixture-owner', profileId: geminiProfile.id, system: 'system', text: 'question', images: [{ page: 1, dataUrl: 'data:image/png;base64,AAAA' }], purpose: 'fixture' });
  // The generic trace redaction must also cover Gemini inline image bytes.
  const { ModelCallTrace } = await import('../lib/model-call-trace.ts');
  const trace = new ModelCallTrace(process.env.JIANTI_DATA_DIR, { ownerId: 'fixture-owner', profileId: profile.id, provider: 'google-generate-content', model: 'gemini', purpose: 'fixture' });
  const captured = requests.find(r => r.body.contents);
  await (await trace.fetch(captured.endpoint, { method: 'POST', headers: Object.fromEntries(captured.headers), body: JSON.stringify(captured.body) })).text();
  const logged = readFileSync(path.join(trace.directory, 'request-1.json'), 'utf8');
  assert.ok(!logged.includes('AAAA') && !logged.includes('fixture-secret')); assert.match(logged, /omittedImage/);
  assert.ok(!logged.includes('x-opencode-session'));
  // Reconstruct a populated v7 fixture. Preserve all profile fields while widening the CHECK constraint.
  const db = getSqlite();
  db.exec("UPDATE model_profiles SET service='custom' WHERE service='opencode-go'; ALTER TABLE model_profiles ADD COLUMN service_old TEXT CHECK(service_old IN ('opencode','openrouter','custom')); UPDATE model_profiles SET service_old=service; ALTER TABLE model_profiles DROP COLUMN service; ALTER TABLE model_profiles RENAME COLUMN service_old TO service; DELETE FROM schema_migrations WHERE version=8;");
  const beforeV8 = db.prepare('SELECT * FROM model_profiles ORDER BY id').all();
  execFileSync(process.execPath, ['--import', './server/register.mjs', '--import', 'tsx', '--input-type=module', '--eval',
    "const {ensureDatabase}=await import('./db/bootstrap.ts'); await ensureDatabase();"], { env: process.env, stdio: 'pipe' });
  assert.equal(db.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, 8);
  assert.deepEqual(db.prepare('SELECT * FROM model_profiles ORDER BY id').all(), beforeV8);
  db.prepare("UPDATE model_profiles SET service='opencode-go' WHERE id=?").run(profile.id);
  assert.throws(() => db.prepare("UPDATE model_profiles SET service='invalid' WHERE id=?").run(profile.id), /CHECK/);
  // A v6 database must also migrate through both versions.

  const beforeMigration = db.prepare('SELECT id,api_key_ciphertext,base_url,provider FROM model_profiles ORDER BY id').all();
  db.exec('ALTER TABLE model_profiles DROP COLUMN service; DELETE FROM schema_migrations WHERE version>=7;');
  execFileSync(process.execPath, ['--import', './server/register.mjs', '--import', 'tsx', '--input-type=module', '--eval',
    "const {ensureDatabase}=await import('./db/bootstrap.ts'); await ensureDatabase();"], { env: process.env, stdio: 'pipe' });
  assert.ok(db.prepare('PRAGMA table_info(model_profiles)').all().some(c => c.name === 'service'));
  assert.equal(db.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, 8);
  assert.deepEqual(db.prepare('SELECT id,api_key_ciphertext,base_url,provider FROM model_profiles ORDER BY id').all(), beforeMigration);
  console.log(JSON.stringify({ passed: true, mockRequests: requests.length, dataDirectory: process.env.JIANTI_DATA_DIR }));
} finally { globalThis.fetch = nativeFetch; }
