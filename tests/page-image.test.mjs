import assert from "node:assert/strict";
import test from "node:test";
import { isPageImageMime, validatePageImage } from "../lib/page-image.ts";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("页面上传只接受可解码且声明匹配的安全位图", async () => {
  assert.equal(isPageImageMime("image/png"), true);
  assert.equal(isPageImageMime("image/svg+xml"), false);
  assert.deepEqual(await validatePageImage(pixel, "image/png", 1, 1), { width: 1, height: 1, extension: ".png" });
  await assert.rejects(() => validatePageImage(pixel, "image/png", 2, 1), /实际尺寸.*声明尺寸/);
  await assert.rejects(() => validatePageImage(Buffer.from("not-an-image"), "image/png", 1, 1), /无法解码|已经损坏/);
  await assert.rejects(() => validatePageImage(pixel, "image/jpeg", 1, 1), /声明格式不一致/);
});
