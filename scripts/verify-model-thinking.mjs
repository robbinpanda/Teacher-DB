// In-process mock and disposable database only; no model credits or live jobs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
process.env.JIANTI_DATA_DIR = path.resolve('tmp', `model-thinking-${crypto.randomUUID()}`);
process.env.JIANTI_DEPLOYMENT_MODE = 'local';
mkdirSync(process.env.JIANTI_DATA_DIR, { recursive: true });
const { POST } = await import('../server/http/handlers/model-profiles/route.ts');
const { callVisionModel, callVisionModelStream, ModelCallError } = await import('../lib/vision-model.ts');
const { callTextModel } = await import('../lib/text-model.ts');
const { getSqlite } = await import('../db/index.ts');
const nativeFetch = globalThis.fetch;
let mode = 'success', calls = 0, signal;
const requests = [];
globalThis.fetch = async (endpoint, init) => {
  assert.equal(endpoint, 'https://opencode.ai/inference/go/v1/chat/completions');
  calls++; signal = init.signal;
  const body = JSON.parse(init.body); requests.push(body);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.reasoning_effort, undefined);
  if (mode === 'reject') return new Response('thinking.type.disabled is not supported', { status: 400 });
  if (mode === 'fallback') { mode = 'success'; return new Response('unsupported formatting', { status: 400 }); }
  const usage = { prompt_tokens: 20, completion_tokens: 32, completion_tokens_details: { reasoning_tokens: mode === 'hidden' ? 32 : 0 } };
  const message = { content: 'answer', ...(mode === 'thinking' ? { reasoning_content: 'fixture reasoning' } : {}) };
  if (body.stream && mode !== 'json-thinking') {
    const event = { choices: [{ delta: message }], usage };
    if (mode === 'thinking') delete event.choices[0].delta.content;
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }
  if (mode === 'json-thinking') message.reasoning_content = 'fixture reasoning';
  return Response.json({ choices: [{ message }], usage });
};
try {
  const response = await POST(new Request('http://localhost/api/model-profiles', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'fixture-owner' }, body: JSON.stringify({ service: 'opencode-go', model: 'mimo-v2.6-flash', apiKey: 'fixture-key' }) }));
  assert.equal(response.status, 201);
  const { profile } = await response.json();
  const input = { ownerId: 'fixture-owner', profileId: profile.id, system: 'system', text: 'question', images: [{ page: 1, dataUrl: 'data:image/png;base64,AAAA' }], purpose: 'page_extraction', jsonMode: true };
  const usageCount = () => getSqlite().prepare('SELECT count(*) n FROM model_usage_events').get().n;
  for (const invoke of [() => callVisionModel(input), () => callTextModel(input), () => callVisionModelStream(input, { onTextDelta: () => {} })]) {
    for (const failure of ['reject', 'thinking', 'hidden']) {
      mode = failure; const before = calls, beforeUsage = usageCount();
      await assert.rejects(invoke, error => error instanceof ModelCallError && error.code === 'thinking_mode_incompatible' && error.retryable === false);
      assert.equal(calls, before + 1, 'incompatible thinking never triggers compatibility retries');
      assert.equal(signal.aborted, true, 'cancel the underlying request');
      assert.equal(usageCount(), beforeUsage + (failure === 'reject' ? 0 : 1), 'reported usage is retained on failures');
    }
    mode = 'fallback'; const before = calls, beforeUsage = usageCount();
    await invoke();
    assert.equal(calls, before + 2);
    assert.deepEqual(requests.at(-1).thinking, { type: 'disabled' });
    assert.equal(usageCount(), beforeUsage + 1, 'successful calls record usage once');
  }
  mode = 'thinking'; let textCalls = 0;
  await assert.rejects(() => callVisionModelStream(input, { onTextDelta: () => { textCalls++; } }), { code: 'thinking_mode_incompatible', retryable: false });
  assert.equal(textCalls, 0, 'thinking-only stream fails immediately without sending empty recognition records');
  mode = 'json-thinking';
  await assert.rejects(() => callVisionModelStream(input, { onTextDelta: () => { textCalls++; } }), { code: 'thinking_mode_incompatible', retryable: false });
  assert.equal(textCalls, 0, 'non-stream JSON fallback also enforces disabled thinking');
  console.log(JSON.stringify({ passed: true, mockRequests: calls, dataDirectory: process.env.JIANTI_DATA_DIR }));
} finally { globalThis.fetch = nativeFetch; }
