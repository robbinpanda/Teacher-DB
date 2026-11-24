import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fetchModelRequest, ModelRequestBudget, retryAfterMs } from "../lib/model-rate-limit.ts";

mkdirSync("tmp", { recursive: true });
const directory = mkdtempSync(path.resolve("tmp/rpm-test-"));
process.env.JIANTI_DATA_DIR = directory;
process.env.JIANTI_MODEL_RPM = "50";
const origin = "https://opencode.ai";
const endpoint = origin + "/inference/go/v1/chat/completions";
const options = { method: "POST", body: JSON.stringify({ model: "deepseek-v4.1-flash" }) };

test("API and worker atomically share 50 starts across users and providers in every rolling minute", async () => {
  const dir = path.join(directory, "processes");
  const gate = new ModelRequestBudget(dir);
  // Queue all tickets before starting either process so both always have demand.
  const owners = ["teacher-a", "teacher-b"];
  const now = 100000;
  const tickets = owners.map((owner, i) => Array.from({ length: 25 }, () => gate.enqueue(owner, i ? "https://other.test" : origin, now)));
  const program = `import { ModelRequestBudget } from ${JSON.stringify(new URL("../lib/model-rate-limit.ts", import.meta.url).href)};
    import { setTimeout as sleep } from "node:timers/promises";
    const gate = new ModelRequestBudget(process.argv[1]);
    for (const ticket of JSON.parse(process.argv[2])) {
      while (gate.tryTake(ticket, () => 100000).wait) await sleep(5);
    }
    gate.close();`;
  try {
    await Promise.all(tickets.map(list => promisify(execFile)(process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", program, dir, JSON.stringify(list)], { timeout: 12000 })));
    const extra = gate.enqueue("teacher-a", origin, now);
    assert.equal(gate.tryTake(extra, () => now + 59_999).wait, 1);
    assert.equal(gate.tryTake(extra, () => now + 60_000).wait, 0);
    // An otherwise idle deployment lends all remaining slots to one user.
    for (let i = 0; i < 49; i++) {
      const t = gate.enqueue("teacher-b", origin, now + 60_001);
      assert.equal(gate.tryTake(t, () => now + 60_001).wait, 0);
    }
    const t = gate.enqueue("teacher-c", origin, now + 60_002);
    assert.equal(gate.tryTake(t, () => now + 119_999).wait, 1);
    assert.equal(gate.tryTake(t, () => now + 120_000).wait, 0);
  } finally { gate.close(); }
});

test("round robin by user, FIFO by task, skip cancelled, crashed and cooling requests", () => {
  const gate = new ModelRequestBudget(path.join(directory, "order"));
  let now = 100000;
  const enqueue = (owner, host = origin) => gate.enqueue(owner, host, now);
  const take = ticket => gate.tryTake(ticket, () => now).wait;
  try {
    const a = Array.from({ length: 4 }, () => enqueue("a"));
    const b = Array.from({ length: 4 }, () => enqueue("b"));
    const c = Array.from({ length: 2 }, () => enqueue("c"));
    for (let i = 0; i < 2; i++) {
      assert.ok(take(b[i]) > 0);
      assert.equal(take(a[i]), 0);
      assert.ok(take(a[i+1]) > 0);
      assert.equal(take(b[i]), 0);
      assert.equal(take(c[i]), 0);
    }
    gate.cancel(a[2]);
    assert.equal(take(a[3]), 0);
    assert.equal(take(b[2]), 0);
    gate.defer(origin, now + 8000);
    gate.defer(origin, now + 3000);
    assert.equal(take(b[3]), 8000);
    assert.equal(take(enqueue("b", "https://other.test")), 0);
    now += 8000;
    assert.equal(take(b[3]), 0);
    assert.equal(take(enqueue("b")), 1200);
    enqueue("crashed", "https://other.test");
    now += 16_000;
    assert.equal(take(enqueue("live", "https://other.test")), 0);
  } finally { gate.close(); }
});

test("429 retries preserve the payload, honour Retry-After across callers, and allow cancellation", async () => {
  const sent = [];
  let wake;
  const cooling = new Promise(resolve => { wake = resolve; });
  const limited = fetchModelRequest("a", endpoint, options, async (_url, init) => {
    sent.push({ at: Date.now(), body: init.body });
    if (sent.length === 1) {
      setImmediate(wake);
      return new Response("slow down", { status: 429, headers: { "Retry-After": "2" } });
    }
    return new Response("ok");
  });
  await cooling;
  const controller = new AbortController();
  const cancelled = fetchModelRequest("b", endpoint, { ...options, signal: controller.signal }, () => assert.fail("cancelled request sent"));
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  const peer = fetchModelRequest("b", endpoint, options, async () => new Response(String(Date.now())));
  assert.equal(await (await limited).text(), "ok");
  assert.ok(Number(await (await peer).text()) - sent[0].at >= 2000);
  assert.equal(sent.length, 2);
  assert.ok(sent[1].at - sent[0].at >= 2000);
  assert.equal(sent[0].body, sent[1].body);
});

test("long cooldowns hold only the affected upstream; date and invalid headers are handled", async () => {
  const original = new Response("quota", { status: 429, headers: { "Retry-After": "300" } });
  assert.equal(await fetchModelRequest("a", endpoint, options, async () => original), original);
  const held = await fetchModelRequest("b", endpoint, options, () => assert.fail("early retry"));
  assert.equal(held.status, 429);
  assert.ok(retryAfterMs(held) >= 299_000);
  assert.equal((await fetchModelRequest("b", "https://other.test/chat", options, async () => new Response())).status, 200);
  const now = Date.UTC(2026, 10, 23);
  assert.equal(retryAfterMs(new Response(null, { headers: { "Retry-After": new Date(now + 6000).toUTCString() } }), now), 6000);
  assert.equal(retryAfterMs(new Response(null, { headers: { "Retry-After": "invalid" } })), undefined);
});

test("configured requests per minute applies to the shared window", () => {
  process.env.JIANTI_MODEL_RPM = "2";
  const gate = new ModelRequestBudget(path.join(directory, "custom-rpm"));
  try {
    const now = 100000;
    for (let i = 0; i < 2; i++) assert.equal(gate.tryTake(gate.enqueue("teacher", origin, now), () => now).wait, 0);
    const ticket = gate.enqueue("teacher", origin, now);
    assert.equal(gate.tryTake(ticket, () => now).wait, 60000);
  } finally {
    gate.close();
    process.env.JIANTI_MODEL_RPM = "50";
  }
});
