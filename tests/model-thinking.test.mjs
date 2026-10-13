import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisionHttpRequest, extractVisionStreamEvent } from '../lib/model-protocols.ts';
import { builtInModelConnection, OPENCODE_MODELS, OPENCODE_GO_MODELS } from '../lib/model-services.ts';
import { compatibilityBody } from '../lib/model-compatibility.ts';
import { hasModelThinking, isThinkingSettingError } from '../lib/model-thinking.ts';

const base = { protocol: 'openai-chat-completions', model: 'fixture', baseUrl: 'https://custom.example/v1', apiKey: 'fixture', system: 'system', text: 'question', images: [], maxOutputTokens: 32768, jsonMode: true };
function assertDisabled(request, expected) {
  for (const body of [request.body, compatibilityBody(request.body)]) {
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value);
  }
}

test('all built-in models disable reasoning with their native protocol on initial calls and retries', () => {
  for (const [service, models] of [['opencode', OPENCODE_MODELS], ['opencode-go', OPENCODE_GO_MODELS]]) {
    for (const { id } of models) {
      const connection = builtInModelConnection(service, id);
      const req = buildVisionHttpRequest({ ...base, ...connection, service, protocol: connection.provider });
      assertDisabled(req, connection.provider === 'openai-responses' ? { reasoning: { effort: 'none' } } : { thinking: { type: 'disabled' } });
      assert.equal(req.body.reasoning_effort, undefined, 'do not send OpenAI effort to native thinking providers');
    }
  }
});

test('OpenRouter uses the explicit off switch instead of hiding reasoning, including legacy profiles', () => {
  for (const service of ['openrouter', undefined]) {
    const req = buildVisionHttpRequest({ ...base, service, baseUrl: 'https://openrouter.ai/api/v1', model: 'xiaomi/mimo-v2.6-flash' });
    assertDisabled(req, { reasoning: { enabled: false, effort: 'none' } });
    assert.equal(req.body.reasoning_effort, undefined);
    assert.equal(req.body.reasoning.exclude, undefined);
  }
});

test('custom profiles cover native model families and all four protocols without changing output limits', () => {
  for (const model of ['xiaomi/mimo-v2.6-flash', 'deepseek-v4.1-flash', 'glm-4.7', 'moonshot/kimi-k2.5', 'claude-haiku-5-5']) {
    assertDisabled(buildVisionHttpRequest({ ...base, service: 'custom', model }), { thinking: { type: 'disabled' }, max_tokens: 32768 });
  }
  assertDisabled(buildVisionHttpRequest({ ...base, model: 'qwen/qwen3.5-plus' }), { enable_thinking: false });
  assertDisabled(buildVisionHttpRequest(base), { reasoning_effort: 'none' });
  assertDisabled(buildVisionHttpRequest({ ...base, protocol: 'openai-responses' }), { reasoning: { effort: 'none' }, max_output_tokens: 32768 });
  assertDisabled(buildVisionHttpRequest({ ...base, protocol: 'anthropic-messages' }), { thinking: { type: 'disabled' } });
  const req = buildVisionHttpRequest({ ...base, protocol: 'google-generate-content', model: 'gemini-2.5-flash' });
  for (const body of [req.body, compatibilityBody(req.body)]) {
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(body.generationConfig.maxOutputTokens, 32768);
  }
});

test('reasoning text, encrypted blocks and hidden reasoning usage are detected across protocols', () => {
  for (const payload of [
    { choices: [{ message: { reasoning_content: 'thinking', content: 'answer' } }] },
    { choices: [{ message: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'fixture' }] } }] },
    { content: [{ type: 'redacted_thinking', data: 'fixture' }] },
    { output: [{ type: 'reasoning' }] },
    { candidates: [{ content: { parts: [{ thought: true, text: 'thinking' }] } }] },
    { usage: { completion_tokens_details: { reasoning_tokens: 32768 } } },
    { usage: { output_tokens_details: { reasoning_tokens: 1 } } },
    { usageMetadata: { thoughtsTokenCount: 1 } },
  ]) assert.equal(hasModelThinking(payload), true);
  for (const payload of [undefined, {}, { choices: [{ message: { content: 'answer', reasoning_content: '' } }] }, { usage: { completion_tokens_details: { reasoning_tokens: 0 } } }]) assert.equal(hasModelThinking(payload), false);
  assert.equal(extractVisionStreamEvent('anthropic-messages', JSON.stringify({ type: 'content_block_start', content_block: { type: 'thinking' } })).thinkingPresent, true);
  assert.equal(extractVisionStreamEvent('openai-responses', JSON.stringify({ type: 'response.output_item.added', item: { type: 'reasoning' } })).thinkingPresent, true);
  assert.equal(extractVisionStreamEvent('openai-chat-completions', JSON.stringify({ choices: [{ delta: { reasoning_details: [{}] } }] })).thinkingPresent, true);
});

test('disabled-thinking rejection is distinguishable from transient provider failures', () => {
  for (const error of ['thinking.type.disabled is not supported', 'only type=enabled', 'reasoning_effort none is invalid', 'thinking budget must be at least the minimum']) assert.equal(isThinkingSettingError(error), true);
  for (const error of ['rate limit', 'unsupported formatting', 'upstream timeout']) assert.equal(isThinkingSettingError(error), false);
});
