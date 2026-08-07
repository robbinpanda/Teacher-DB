import assert from "node:assert/strict";
import test from "node:test";
import { resolveExtractionPage, selectPrimaryExtractionRegion } from "../lib/extraction-pages.ts";

test("保留模型返回的真实页码", () => {
  assert.equal(resolveExtractionPage(12, [12, 13], 12), 12);
  assert.equal(resolveExtractionPage(13, [12, 13], 12), 13);
});

test("keeps a question found only on the lookahead page", () => {
  const lookaheadRegion = { page: 2, bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.2 } };
  assert.equal(selectPrimaryExtractionRegion([lookaheadRegion], 1), lookaheadRegion);
});

test("把模型的局部图片序号映射为原卷真实页码", () => {
  assert.equal(resolveExtractionPage(1, [9, 10], 9), 9);
  assert.equal(resolveExtractionPage(2, [9, 10], 9), 10);
});

test("不猜测无法映射的页码", () => {
  assert.equal(resolveExtractionPage(7, [12, 13], 12), 7);
});
