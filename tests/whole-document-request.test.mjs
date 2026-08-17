import assert from "node:assert/strict";
import test from "node:test";
import { buildVisionHttpRequest } from "../lib/model-protocols.ts";

test("20 页试卷会组成一次多图模型请求", () => {
  const images = Array.from({ length: 20 }, (_, index) => ({
    page: index + 1,
    dataUrl: "data:image/jpeg;base64,AA==",
  }));
  const request = buildVisionHttpRequest({
    protocol: "openai-chat-completions",
    baseUrl: "https://example.com/v1",
    model: "vision-model",
    apiKey: "test-key",
    system: "整卷识别",
    text: "一次返回完整结构",
    images,
    jsonMode: true,
  });
  const messages = request.body.messages;
  assert.equal(Array.isArray(messages), true);
  const user = messages[1];
  assert.equal(Array.isArray(user.content), true);
  assert.equal(user.content.filter((block) => block.type === "image_url").length, 20);
  assert.equal(user.content.filter((block) => block.type === "text" && /原试卷第/.test(block.text)).length, 20);
});

test("整卷识别请求启用单次模型流而不是逐页调用", () => {
  for (const protocol of ["openai-chat-completions", "openai-responses", "anthropic-messages"]) {
    const request = buildVisionHttpRequest({
      protocol,
      baseUrl: "https://example.com/v1",
      model: "vision-model",
      apiKey: "test-key",
      system: "整卷识别",
      text: "逐题返回",
      images: [{ page: 1, dataUrl: "data:image/jpeg;base64,AA==" }],
      stream: true,
    });
    assert.equal(request.body.stream, true);
  }
});
