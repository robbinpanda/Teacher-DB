import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionDocument } from "../lib/document-state.ts";

test("a document cannot skip rendering/extraction and jump to approved completion", () => {
  assert.equal(canTransitionDocument("uploading", "complete"), false);
  assert.equal(canTransitionDocument("failed", "complete"), false);
  assert.equal(canTransitionDocument("reviewing", "complete"), true);
  assert.equal(canTransitionDocument("awaiting_model", "extracting"), true);
  assert.equal(canTransitionDocument("complete", "uploading"), false);
  assert.equal(canTransitionDocument("unknown", "complete"), false);
});
