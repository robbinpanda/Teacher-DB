import assert from "node:assert/strict";
import test from "node:test";
import { readFormDataPayload, readJsonPayload } from "../lib/request-payload.ts";

test("损坏或非对象 JSON 会稳定返回 400", async () => {
  const broken = await readJsonPayload(new Request("http://local.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }));
  assert.equal(broken.ok, false);
  assert.equal(broken.response.status, 400);
  assert.match((await broken.response.json()).error, /有效的 JSON/);

  const array = await readJsonPayload(new Request("http://local.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]",
  }));
  assert.equal(array.ok, false);
  assert.match((await array.response.json()).error, /JSON 对象/);
});

test("JSON 对象和 multipart 表单可以正常解析", async () => {
  const json = await readJsonPayload(new Request("http://local.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: 1 }),
  }));
  assert.deepEqual(json, { ok: true, value: { value: 1 } });

  const data = new FormData();
  data.set("name", "试卷");
  const form = await readFormDataPayload(new Request("http://local.test", { method: "POST", body: data }));
  assert.equal(form.ok, true);
  assert.equal(form.value.get("name"), "试卷");
});

test("错误 Content-Type 的表单请求会稳定返回 400", async () => {
  const result = await readFormDataPayload(new Request("http://local.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
});
