import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInModelConnection, normalizeModelService } from '../lib/model-services.ts';
import { buildVisionHttpRequest, extractVisionStreamEvent, extractVisionResponseText } from '../lib/model-protocols.ts';
import { extractModelTokenUsage } from '../lib/model-usage.ts';
import { compatibilityBody } from '../lib/model-compatibility.ts';

const base = { apiKey: 'fixture-key', system: 'system', text: 'question', images: [{ page: 1, dataUrl: 'data:image/png;base64,AAAA' }], maxOutputTokens: 64 };
function request(model, extra = {}) {
  const connection = builtInModelConnection('opencode', model);
  return buildVisionHttpRequest({ ...base, ...connection, protocol: connection.provider, service: 'opencode', ...extra });
}
test('OpenCode exact model routing includes Qwen exceptions and rejects unknown/System One models', () => {
  assert.equal(request('opencode/kimi-k2.6').endpoint, 'https://opencode.ai/inference/openai/v1/chat/completions');
  assert.equal(request('gpt-5.5').endpoint, 'https://opencode.ai/inference/openai/v1/responses');
  assert.equal(request('qwen3.8-max').protocol, 'openai-chat-completions');
  assert.equal(request('qwen3.8-flash').protocol, 'anthropic-messages');
  assert.throws(() => request('jev-1.13'), /尚未适配/);
  assert.throws(() => request('made-up-model'), /尚未适配/);
});
test('OpenCode alone gets Bearer auth, app identity, stable explicit session and independent default sessions', () => {
  for (const model of ['kimi-k2.6', 'gpt-5.5', 'claude-sonnet-4-6', 'gemini-3.1-pro']) {
    const req = request(model, { sessionId: 'session-fixture' });
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers['x-goog-api-key'], undefined);
    assert.equal(req.headers['x-opencode-session'], 'session-fixture');
    assert.match(req.headers['user-agent'], /^Jianti-Teacher-Question-Bank\//);
    assert.equal(req.body.reasoning_effort, undefined);
  }
  assert.notEqual(request('kimi-k2.6').headers['x-opencode-session'], request('kimi-k2.6').headers['x-opencode-session']);
  for (const service of ['openrouter', 'custom']) {
    const req = buildVisionHttpRequest({ ...base, model: 'model', baseUrl: 'https://other.example/v1', protocol: 'anthropic-messages', service });
    assert.equal(req.headers['x-opencode-session'], undefined);
    assert.equal(req.headers['user-agent'], undefined);
    assert.equal(req.headers['x-api-key'], 'fixture-key');
  }
  assert.throws(() => request('kimi-k2.6', { baseUrl: 'https://opencode.ai.evil.example/v1' }), /官方/);
  assert.throws(() => request('kimi-k2.6', { sessionId: 'bad\r\nheader' }), /session ID/);
});
test('Legacy service inference uses exact origins and explicit custom remains custom', () => {
  assert.equal(normalizeModelService(null, 'https://openrouter.ai/api/v1'), 'openrouter');
  assert.equal(normalizeModelService(null, 'https://opencode.ai/inference/openai/v1'), 'opencode');
  assert.equal(normalizeModelService('custom', 'https://opencode.ai/inference/openai/v1'), 'custom');
  assert.equal(normalizeModelService(null, 'https://opencode.ai.evil.example/inference/v1'), 'custom');
  assert.equal(normalizeModelService(null, 'https://opencode.ai/inference/custom/conn_fixture'), 'custom');
  assert.throws(() => normalizeModelService('invalid'));
});
test('Gemini images, SSE, non-stream text and usage are normalized without leaking thinking into answers', () => {
  const req = request('gemini-3.1-pro', { stream: true, jsonMode: true });
  assert.equal(req.endpoint, 'https://opencode.ai/inference/google/v1beta/models/gemini-3.1-pro:streamGenerateContent?alt=sse');
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
