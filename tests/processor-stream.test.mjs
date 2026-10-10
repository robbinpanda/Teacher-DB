import test from "node:test";
import assert from "node:assert/strict";
import { readProcessorEvents } from "../server/contracts/processor.ts";

function stream(chunks) { return new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }); }
async function collect(chunks) { const events = []; for await (const event of readProcessorEvents(stream(chunks))) events.push(event); return events; }
test("processor NDJSON preserves events split across arbitrary transport chunks", async () => {
  const events = await collect(['{"type":"meta', 'data","protocolVersion":1,"pageCount":2}\n{"type":"complete","pageCount":2}\n']);
  assert.deepEqual(events.map(event => event.type), ["metadata", "complete"]);
});
test("processor rejects truncated and malformed responses instead of marking complete", async () => {
  await assert.rejects(collect(['{"type":"complete","pageCount":2}']), /截断/);
  await assert.rejects(collect(['{"type":"metadata","protocolVersion":1,"pageCount":1000}\n']));
  await assert.rejects(collect(['Server starting\n']));
});
