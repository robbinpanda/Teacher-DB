import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelCallTrace } from "../lib/model-call-trace.ts";
import { getDocumentModelTrace, listDocumentModelTraces, readDocumentModelTraceContent } from "../lib/model-trace-reader.ts";

const context = { ownerId: "teacher", profileId: "profile", model: "fixture", provider: "openai-chat-completions", purpose: "page_extraction", documentId: "paper" };
function root() { return mkdtempSync(path.join(tmpdir(), "jianti-trace-reader-")); }
test("调用历史区分模型返回成功与结果校验失败，保留未结束记录并隔离教师与试卷", async () => {
  const directory = root();
  const success = new ModelCallTrace(directory, context); success.finish("complete"); success.validation("complete", { questionTotal: 20 });
  const failed = new ModelCallTrace(directory, context); failed.finish("complete"); failed.validation("failed", { error: "缺少第21题" });
  const partial = new ModelCallTrace(directory, context); partial.output("text", "未完成JSON");
  const other = new ModelCallTrace(directory, { ...context, ownerId: "other" }); other.output("text", "private response");
  const paper = new ModelCallTrace(directory, { ...context, documentId: "other-paper" }); paper.output("text", "other paper response");
  const list = await listDocumentModelTraces(directory, "teacher", "paper");
  assert.equal(list.traces.length, 3);
  assert.equal(list.traces.find(item => item.id === failed.id).status, "failed");
  assert.equal(list.traces.find(item => item.id === failed.id).error, "缺少第21题");
  assert.equal(list.traces.find(item => item.id === success.id).status, "complete");
  assert.equal(list.traces.find(item => item.id === partial.id).status, "unfinished");
  for (const id of [other.id, paper.id, "../../secrets"]) {
    assert.equal(await getDocumentModelTrace(directory, "teacher", "paper", id), null);
    assert.equal(await readDocumentModelTraceContent(directory, "teacher", "paper", id, "output.txt"), null);
  }
  assert.equal(await readDocumentModelTraceContent(directory, "teacher", "paper", partial.id, "../../manifest.json"), null);
  assert.equal(await readDocumentModelTraceContent(directory, "teacher", "paper", partial.id, "output.txt", -1), null);
  assert.equal(await readDocumentModelTraceContent(directory, "teacher", "paper", partial.id, "output.txt", Infinity), null);
  assert.equal((await getDocumentModelTrace(directory, "teacher", "paper", partial.id)).files.find(file => file.name === "output.txt").bytes, Buffer.byteLength("未完成JSON"));
});

test("大回复分页保持 UTF-8 完整，下一段不会丢字或重复内容", async () => {
  const directory = root(), trace = new ModelCallTrace(directory, context);
  const original = "中文🙂数学".repeat(14000);
  trace.output("text", original);
  let offset = 0, combined = "", chunks = 0;
  do {
    const content = await readDocumentModelTraceContent(directory, "teacher", "paper", trace.id, "output.txt", offset);
    assert.doesNotMatch(content.text, /�/);
    assert.ok(Buffer.byteLength(content.text) <= 64 * 1024);
    combined += content.text; chunks++;
    if (content.nextOffset === null) break;
    assert.ok(content.nextOffset > offset);
    offset = content.nextOffset;
  } while (true);
  assert.ok(chunks > 1);
  assert.equal(combined, original);
});

test("超过50次调用时历史分页不重复、不漏项，损坏的未完成清单不会导致列表崩溃", async () => {
  const directory = root();
  for (let index = 0; index < 55; index++) new ModelCallTrace(directory, context);
  const corrupt = new ModelCallTrace(directory, context);
  writeFileSync(path.join(corrupt.directory, "manifest.json"), '{"traceId":');
  const first = await listDocumentModelTraces(directory, "teacher", "paper");
  assert.equal(first.traces.length, 50);
  const second = await listDocumentModelTraces(directory, "teacher", "paper", first.nextCursor);
  assert.equal(second.traces.length, 5);
  assert.equal(new Set([...first.traces, ...second.traces].map(trace => trace.id)).size, 55);
  assert.equal(second.nextCursor, null);
  assert.equal(await getDocumentModelTrace(directory, "teacher", "paper", corrupt.id), null);
  assert.ok(readFileSync(path.join(corrupt.directory, "manifest.json"), "utf8"));
});
