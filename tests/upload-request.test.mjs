import assert from "node:assert/strict";
import test from "node:test";
import { fetchUploadJson, uploadRetryDelay } from "../lib/upload-request.ts";

function requests(responses) {
  const calls = [];
  const delays = [];
  return {
    calls, delays,
    options: {
      request: async (...args) => {
        calls.push(args);
        const response = responses.shift();
        if (response instanceof Error) throw response;
        assert.ok(response, "unexpected retry");
        return response;
      },
      sleep: async milliseconds => { delays.push(milliseconds); },
    },
  };
}

test("首次启动的临时纯文本错误、HTML 和网络断开会退避后重试同一上传", async () => {
  const fixture = requests([
    new Response("Server action not found.", { status: 404, headers: { "x-nextjs-action-not-found": "1" } }),
    new Response("<html>Starting</html>", { status: 503 }),
    new TypeError("Failed to fetch"),
    Response.json({ id: "saved-page" }, { status: 201 }),
  ]);
  const body = new FormData();
  body.set("page", new Blob(["fixture"]), "page.jpg");
  assert.deepEqual(await fetchUploadJson("/api/documents/id/pages", { method: "POST", body }, fixture.options), { id: "saved-page" });
  assert.deepEqual(fixture.delays, [500, 1000, 2000]);
  assert.ok(fixture.calls.every(([url, init]) => url === "/api/documents/id/pages" && init.body === body));
});

test("明确的校验错误和正常 404 不重试，并显示服务端错误", async () => {
  for (const response of [Response.json({ error: "页面图片无效" }, { status: 422 }), new Response("Not found", { status: 404 })]) {
    const fixture = requests([response]);
    await assert.rejects(() => fetchUploadJson("/upload", {}, fixture.options), /页面图片无效|HTTP 404/);
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.delays, []);
  }
});

test("连续非 JSON、空值和数组响应耗尽重试后给出可读错误", async () => {
  const fixture = requests([new Response("Server action not found.", { status: 500 }), Response.json(null), Response.json([])]);
  await assert.rejects(() => fetchUploadJson("/upload", {}, { ...fixture.options, attempts: 3 }), /上传接口暂时不可用/);
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(fixture.delays, [500, 1000]);
});

test("缺失或非法 Retry-After 使用递增退避，合法秒数和日期得到尊重", () => {
  assert.equal(uploadRetryDelay(new Response(), 1), 500);
  assert.equal(uploadRetryDelay(new Response(), 2), 1000);
  assert.equal(uploadRetryDelay(new Response(), 10), 8000);
  assert.equal(uploadRetryDelay(new Response(null, { headers: { "retry-after": "invalid" } }), 2), 1000);
  assert.equal(uploadRetryDelay(new Response(null, { headers: { "retry-after": "-1" } }), 2), 1000);
  assert.equal(uploadRetryDelay(new Response(null, { headers: { "retry-after": "2" } }), 2), 2000);
  assert.equal(uploadRetryDelay(new Response(null, { headers: { "retry-after": "0" } }), 2), 0);
  const delay = uploadRetryDelay(new Response(null, { headers: { "retry-after": new Date(Date.now() + 60000).toUTCString() } }), 1);
  assert.ok(delay > 58000 && delay <= 60000);
});
