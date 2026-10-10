import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelCallTrace } from "../lib/model-call-trace.ts";

const context = { ownerId: "teacher", profileId: "profile", provider: "openai-chat-completions", model: "fixture", purpose: "page_extraction", documentId: "paper" };
const options = { method: "POST", headers: { authorization: "Bearer secret-key" }, body: JSON.stringify({ model: "fixture", api_key: "secret-key", messages: [{ content: "原提示词" }, { image_url: { url: "data:image/jpeg;base64,AAAA" } }] }) };
const endpoint = "https://provider.example/v1/chat/completions?api_key=secret-key";
function create() { return new ModelCallTrace(mkdtempSync(path.join(tmpdir(), "jianti-trace-")), context); }
function file(trace, name) { return readFileSync(path.join(trace.directory, name), "utf8"); }

test("原始流字节在解析之前落盘，跨 UTF-8 分块及不合法 JSON 也原样保留", async () => {
  const trace = create();
  const bytes = Buffer.from('data: {"text":"中文"}\n\ndata: {not valid JSON}\n\n');
  const source = new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, 17)); controller.enqueue(bytes.subarray(17)); controller.close();
  } });
  const response = await trace.fetch(endpoint, options, async () => new Response(source));
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.deepEqual(readFileSync(path.join(trace.directory, "response-1.raw")), Buffer.from(first.value));
  while (!(await reader.read()).done) { /* Consume remainder. */ }
  assert.deepEqual(readFileSync(path.join(trace.directory, "response-1.raw")), bytes);
  trace.output("text", '{"event":"meta","questionCount":21}');
  trace.output("thinking", "正在清点题号");
  trace.finish("complete");
  trace.validation("failed", { error: "实际返回20题，缺少第21题" });
  assert.equal(JSON.parse(file(trace, "result.json")).status, "complete");
  assert.equal(JSON.parse(file(trace, "validation.json")).status, "failed");
  assert.match(file(trace, "output.txt"), /questionCount.*21/);
  assert.equal(file(trace, "thinking.txt"), "正在清点题号");
  const requests = file(trace, "request-1.json");
  assert.match(requests, /原提示词/);
  assert.doesNotMatch(requests, /secret-key|base64,AAAA/);
  assert.match(requests, /sha256/);
});

test("网络中断、主动取消和未写终态的进程中断都保留已收到的原始内容", async () => {
  for (const mode of ["error", "cancel", "crash"]) {
    const trace = create();
    let reads = 0;
    const response = await trace.fetch(endpoint, options, async () => new Response(new ReadableStream({
      pull(controller) {
        if (++reads === 1) controller.enqueue(Buffer.from("partial model response"));
        else controller.error(new Error("provider disconnected"));
      },
    }, { highWaterMark: 0 })));
    const reader = response.body.getReader();
    await reader.read();
    if (mode === "error") {
      await assert.rejects(reader.read(), /provider disconnected/);
      trace.finish("failed", new Error("provider disconnected"));
      assert.equal(JSON.parse(file(trace, "result.json")).status, "failed");
    } else if (mode === "cancel") await reader.cancel("paused");
    assert.equal(file(trace, "response-1.raw"), "partial model response");
    if (mode !== "error") assert.ok(!readdirSync(trace.directory).includes("result.json"));
  }
});

test("400 兼容回退和重新识别分别保留回复，不覆盖历史调用", async () => {
  const trace = create();
  const first = await trace.fetch(endpoint, options, async () => new Response("original provider error", { status: 400 }));
  await first.text();
  const second = await trace.fetch(endpoint, options, async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
  await second.json();
  trace.finish("complete");
  const retry = new ModelCallTrace(path.resolve(trace.directory, "../../.."), context);
  assert.notEqual(trace.directory, retry.directory);
  assert.equal(file(trace, "response-1.raw"), "original provider error");
  assert.equal(JSON.parse(file(trace, "response-1.json")).status, 400);
  assert.match(file(trace, "response-2.raw"), /"content":"ok"/);
});

test("Anthropic 图片数据也只保留指纹，避免把图片 base64 写入提示词日志", async () => {
  const trace = create();
  const response = await trace.fetch(endpoint, { ...options, body: JSON.stringify({ system: "本次系统提示词", messages: [{ content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "large-image-base64" } }] }] }) }, async () => Response.json({ ok: true }));
  await response.json();
  const request = file(trace, "request-1.json");
  assert.doesNotMatch(request, /large-image-base64/);
  assert.match(request, /sha256/);
  assert.match(request, /本次系统提示词/);
});
