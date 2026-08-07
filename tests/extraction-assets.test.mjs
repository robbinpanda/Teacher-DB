import assert from "node:assert/strict";
import test from "node:test";
import { findMatchingAsset } from "../lib/extraction-assets.ts";

test("reuses an existing asset when overlapping extraction passes find the same figure", () => {
  const existing = [{ id: "figure-a", pageId: "page-1", bbox: { x: 10, y: 20, width: 30, height: 20 } }];
  assert.equal(findMatchingAsset(existing, "page-1", { x: 10.5, y: 20.5, width: 29, height: 19 })?.id, "figure-a");
});

test("keeps multiple separate figures on the same page", () => {
  const existing = [{ id: "figure-a", pageId: "page-1", bbox: { x: 10, y: 20, width: 20, height: 20 } }];
  assert.equal(findMatchingAsset(existing, "page-1", { x: 55, y: 20, width: 20, height: 20 }), undefined);
});
