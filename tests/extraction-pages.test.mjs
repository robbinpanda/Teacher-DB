import assert from "node:assert/strict";
import test from "node:test";
import { resolveExtractionPage } from "../lib/extraction-pages.ts";

test("保留模型返回的真实页码", () => {
  assert.equal(resolveExtractionPage(12, [12, 13], 12), 12);
  assert.equal(resolveExtractionPage(13, [12, 13], 12), 13);
});

test("把模型的局部图片序号映射为原卷真实页码", () => {
  assert.equal(resolveExtractionPage(1, [9, 10], 9), 9);
  assert.equal(resolveExtractionPage(2, [9, 10], 9), 10);
});

test("不猜测无法映射的页码", () => {
  assert.equal(resolveExtractionPage(7, [12, 13], 12), 7);
});
