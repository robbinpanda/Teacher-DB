import test from "node:test";
import assert from "node:assert/strict";
import { buildVisionHttpRequest } from "../lib/model-protocols.ts";
import { compatibilityBody } from "../lib/model-compatibility.ts";

test("三种协议的兼容重试保留输出预算、消息与推理限制且不修改原请求", () => {
  for (const protocol of ["openai-chat-completions", "openai-responses", "anthropic-messages"]) {
    const { body } = buildVisionHttpRequest({ protocol, baseUrl: "http://localhost/v1", apiKey: "test", model: "fixture", system: "约束", text: "材料", images: [], maxOutputTokens: 1800, jsonMode: true, temperature: 0.3 });
    const fallback = compatibilityBody(body);
    assert.equal(fallback[protocol === "openai-responses" ? "max_output_tokens" : "max_tokens"], 1800);
    assert.deepEqual(fallback.messages ?? fallback.input, body.messages ?? body.input);
    assert.deepEqual(fallback.reasoning ?? fallback.reasoning_effort, body.reasoning ?? body.reasoning_effort);
    assert.equal(fallback.response_format, undefined);
    assert.equal(fallback.temperature, undefined);
    assert.equal(body.temperature, 0.3);
  }
});
