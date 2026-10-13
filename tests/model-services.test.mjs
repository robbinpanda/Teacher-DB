import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInModelConnection, normalizeModelService, OPENCODE_MODELS, OPENCODE_GO_MODELS } from '../lib/model-services.ts';
import { buildVisionHttpRequest, extractVisionStreamEvent, extractVisionResponseText } from '../lib/model-protocols.ts';
import { extractModelTokenUsage } from '../lib/model-usage.ts';
import { compatibilityBody } from '../lib/model-compatibility.ts';

const base = { apiKey: 'fixture-key', system: 'system', text: 'question', images: [{ page: 1, dataUrl: 'data:image/png;base64,AAAA' }], maxOutputTokens: 64 };
function request(model, extra = {}) {
  const service = extra.service ?? 'opencode';
  const connection = builtInModelConnection(service, model);
  return buildVisionHttpRequest({ ...base, ...connection, protocol: connection.provider, service, ...extra });
}

test('Both presets offer exactly four models and Go uses its own endpoint and MiMo ID', () => {
  const go = model => request(model, { service: 'opencode-go' });
  assert.equal(go('opencode-go/mimo-v2.6-flash').endpoint, 'https://opencode.ai/inference/go/v1/chat/completions');
  assert.equal(go('opencode-go/mimo-v2.6-flash').body.model, 'mimo-v2.6-flash');
  assert.equal(go('gpt-6-luna').endpoint, 'https://opencode.ai/inference/go/v1/responses');
  assert.deepEqual(OPENCODE_MODELS.map(m => m.id), ['gpt-6-luna', 'claude-haiku-5-5', 'mimo-v2.6-flash-free', 'deepseek-v4.1-flash']);
  assert.deepEqual(OPENCODE_GO_MODELS.map(m => m.id), ['gpt-6-luna', 'claude-haiku-5-5', 'mimo-v2.6-flash', 'deepseek-v4.1-flash']);
  assert.equal(go('claude-haiku-5-5').endpoint, 'https://opencode.ai/inference/go/v1/messages');
  assert.equal(go('deepseek-v4.1-flash').endpoint, 'https://opencode.ai/inference/go/v1/chat/completions');
  for (const { id } of OPENCODE_GO_MODELS) {
    const req = go(id);
    assert.match(req.endpoint, /^https:\/\/opencode.ai\/inference\/go\/v1\//);
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    assert.match(req.headers['user-agent'], /^Jianti-Teacher-Question-Bank\//);
    assert.ok(req.headers['x-opencode-session']);
    assert.equal(req.headers['x-api-key'], undefined);
  }
  assert.throws(() => go('gpt-5.5'), /Go 套餐.*尚未适配/);
  assert.throws(() => go('mimo-v2.6-flash-free'), /尚未适配/);
  assert.throws(() => go('opencode/deepseek-v4.1-flash'), /尚未适配/);
});

test('A preset cannot accidentally send a Go request to the ordinary billing route or vice versa', () => {
  assert.throws(() => request('deepseek-v4.1-flash', { service: 'opencode-go', baseUrl: 'https://opencode.ai/inference/openai/v1' }), /所选服务/);
  assert.throws(() => request('deepseek-v4.1-flash', { baseUrl: 'https://opencode.ai/inference/go/v1' }), /所选服务/);
  assert.throws(() => request('deepseek-v4.1-flash', { service: 'opencode-go', baseUrl: 'https://opencode.ai.evil.example/inference/go/v1' }), /官方/);
});
test('Ordinary model routing uses documented protocols and rejects models outside the four choices', () => {
  assert.equal(request('opencode/deepseek-v4.1-flash').endpoint, 'https://opencode.ai/inference/openai/v1/chat/completions');
  assert.equal(request('gpt-6-luna').endpoint, 'https://opencode.ai/inference/openai/v1/responses');
  assert.equal(request('mimo-v2.6-flash-free').protocol, 'openai-chat-completions');
  assert.throws(() => request('mimo-v2.6-flash'), /尚未适配/);
  assert.throws(() => request('gpt-5.5'), /尚未适配/);
  assert.equal(request('claude-haiku-5-5').protocol, 'anthropic-messages');
  assert.throws(() => request('jev-1.13'), /尚未适配/);
  assert.throws(() => request('made-up-model'), /尚未适配/);
});
test('OpenCode alone gets Bearer auth, app identity, stable explicit session and independent default sessions', () => {
  for (const { id: model } of OPENCODE_MODELS) {
    const req = request(model, { sessionId: 'session-fixture' });
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers['x-goog-api-key'], undefined);
    assert.equal(req.headers['x-opencode-session'], 'session-fixture');
    assert.match(req.headers['user-agent'], /^Jianti-Teacher-Question-Bank\//);
    assert.equal(req.body.reasoning_effort, undefined);
  }
  assert.notEqual(request('deepseek-v4.1-flash').headers['x-opencode-session'], request('deepseek-v4.1-flash').headers['x-opencode-session']);
  for (const service of ['openrouter', 'custom']) {
    const req = buildVisionHttpRequest({ ...base, model: 'model', baseUrl: 'https://other.example/v1', protocol: 'anthropic-messages', service });
    assert.equal(req.headers['x-opencode-session'], undefined);
    assert.equal(req.headers['user-agent'], undefined);
    assert.equal(req.headers['x-api-key'], 'fixture-key');
  }
  assert.throws(() => request('deepseek-v4.1-flash', { baseUrl: 'https://opencode.ai.evil.example/v1' }), /官方/);
  assert.throws(() => request('deepseek-v4.1-flash', { sessionId: 'bad\r\nheader' }), /session ID/);
});
test('Legacy service inference uses exact origins and explicit custom remains custom', () => {
  assert.equal(normalizeModelService(null, 'https://openrouter.ai/api/v1'), 'openrouter');
  assert.equal(normalizeModelService(null, 'https://opencode.ai/inference/openai/v1'), 'opencode');
  assert.equal(normalizeModelService(null, 'https://opencode.ai/inference/go/v1'), 'opencode-go');
  assert.equal(normalizeModelService('custom', 'https://opencode.ai/inference/go/v1'), 'custom');
  assert.equal(normalizeModelService(null, 'https://opencode.ai.evil.example/inference/go/v1'), 'custom');
  assert.equal(normalizeModelService('custom', 'https://opencode.ai/inference/openai/v1'), 'custom');
  assert.equal(normalizeModelService(null, 'https://opencode.ai.evil.example/inference/v1'), 'custom');
  assert.equal(normalizeModelService(null, 'https://opencode.ai/inference/custom/conn_fixture'), 'custom');
  assert.throws(() => normalizeModelService('invalid'));
});
test('Gemini images, SSE, non-stream text and usage are normalized without leaking thinking into answers', () => {
  const req = buildVisionHttpRequest({ ...base, service: 'custom', model: 'gemini-3.1-pro', protocol: 'google-generate-content', baseUrl: 'https://custom.example/v1beta', stream: true, jsonMode: true });
  assert.equal(req.endpoint, 'https://custom.example/v1beta/models/gemini-3.1-pro:streamGenerateContent?alt=sse');
  assert.deepEqual(req.body.contents[0].parts[2], { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
  assert.equal(req.body.generationConfig.maxOutputTokens, 64);
  const payload = { candidates: [{ content: { parts: [{ text: 'private thinking', thought: true }, { text: 'answer' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5 } };
  const event = extractVisionStreamEvent(req.protocol, JSON.stringify(payload));
  assert.equal(event.textDelta, 'answer'); assert.equal(event.thinkingDelta, 'private thinking');
  assert.equal(extractVisionResponseText(req.protocol, payload), 'answer');
  assert.deepEqual(extractModelTokenUsage(req.protocol, payload), { inputTokens: 80, cachedInputTokens: 20, outputTokens: 15, cachedOutputTokens: 0 });
  const fallback = compatibilityBody(req.body);
  assert.equal(fallback.generationConfig.maxOutputTokens, 64);
  assert.equal(fallback.generationConfig.responseMimeType, undefined);
  assert.throws(() => extractVisionResponseText(req.protocol, { promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
});
