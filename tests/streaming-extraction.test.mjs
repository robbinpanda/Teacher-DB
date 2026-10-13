import assert from "node:assert/strict";
import test from "node:test";
import { extractVisionStreamEvent } from "../lib/model-protocols.ts";
import { ExtractionStreamParser } from "../lib/streaming-extraction.ts";

function parseChunks(source, size) {
  const parser = new ExtractionStreamParser(), records = [];
  for (let i = 0; i < source.length; i += size) records.push(...parser.push(source.slice(i, i + size)));
  return [...records, ...parser.finish()];
}

test("单题缺外层括号不吞掉前后题，修复必须带原文和待审核警告", () => {
  const q = n => JSON.stringify({ event: "question", question: { number: String(n), stem: "集合 {1,2}" } });
  for (const damaged of [q(2).slice(1), q(2).slice(0, -1)]) {
    for (const size of [1, 7, 10000]) {
      const records = parseChunks([q(1), damaged, q(3), '{"event":"done"}'].join("\n"), size);
      assert.deepEqual(records.filter(r => r.event === "question").map(r => r.question.number), ["1", "2", "3"]);
      assert.ok(records[1].warning);
      assert.equal(records[1].raw, damaged);
    }
  }
});

test("不可恢复的语法错误、未闭合字符串、截断末题只产生独立异常", () => {
  for (const damaged of [
    '{"event":"question","question":{"number":"2","stem": invalid}}',
    '{"event":"question","question":{"number":"2","stem":"未闭合',
  ]) for (const size of [1, 9, 10000]) {
    const good = '{"event":"question","question":{"number":"3","stem":"后续正常"}}';
    const records = parseChunks(damaged + "\n" + good, size);
    assert.equal(records[0].event, "issue"); assert.equal(records[0].number, "2");
    assert.equal(records.at(-1).question.number, "3");
  }
  assert.equal(parseChunks('{"event":"question","question":{"number":"4","stem":"', 4)[0].event, "issue");
});

test("格式化 JSON、字符串中的 event 和连续无换行对象保持原样", () => {
  const records = [{ event: "meta", questionCount: 1 }, { event: "question", question: { number: "1", stem: '文字 {"event":"done"} 与 \\"' } }, { event: "done" }];
  for (const size of [1, 7, 10000]) {
    assert.deepEqual(parseChunks(records.map(r => JSON.stringify(r, null, 2)).join(""), size).map(r => r.event), ["meta", "question", "done"]);
  }
});

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
