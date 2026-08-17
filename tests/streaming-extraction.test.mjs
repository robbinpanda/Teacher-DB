import assert from "node:assert/strict";
import test from "node:test";
import { extractVisionStreamEvent } from "../lib/model-protocols.ts";
import { ExtractionStreamParser } from "../lib/streaming-extraction.ts";

test("增量解析器可跨任意分片逐题产出，且不会被字符串内花括号干扰", () => {
  const parser = new ExtractionStreamParser();
  const source = [
    '{"event":"meta","questionCount":2,"documentMeta":{"subject":"数学"}}\n',
    '{"event":"question","question":{"number":"1","stem":"集合 {1,2}"}}\n',
    '{"event":"question","question":{"number":"2","stem":"第二题"}}\n',
    '{"event":"done"}',
  ].join("");
  const records = [];
  for (let index = 0; index < source.length; index += 7) records.push(...parser.push(source.slice(index, index + 7)));
  records.push(...parser.finish());
  assert.deepEqual(records.map((record) => record.event), ["meta", "question", "question", "done"]);
  assert.equal(records[1].question.stem, "集合 {1,2}");
});

test("三种模型协议都能区分正文和思考活动", () => {
  assert.deepEqual(
    extractVisionStreamEvent("openai-chat-completions", JSON.stringify({ choices: [{ delta: { content: "正文" } }] })),
    { textDelta: "正文" },
  );
  assert.deepEqual(
    extractVisionStreamEvent("openai-chat-completions", JSON.stringify({ choices: [{ delta: { reasoning_content: "思考" } }] })),
    { thinkingDelta: "思考" },
  );
  assert.deepEqual(
    extractVisionStreamEvent("openai-responses", JSON.stringify({ type: "response.output_text.delta", delta: "正文" })),
    { textDelta: "正文" },
  );
  assert.deepEqual(
    extractVisionStreamEvent("anthropic-messages", JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "思考" } })),
    { thinkingDelta: "思考" },
  );
});
