import test from "node:test";
import assert from "node:assert/strict";
import { extractionInputSchema, uploadResponseSchema, progressResponseSchema, uploadMetadataSchema } from "../lib/api-contracts.ts";
test("API contracts reject missing IDs, owner spoofing fields, and invalid progress shape", () => {
  assert.equal(extractionInputSchema.safeParse({ documentId: "", ownerId: "someone" }).success, false);
  assert.equal(extractionInputSchema.safeParse({ documentId: "id", ownerId: "someone" }).success, false);
  assert.equal(uploadResponseSchema.safeParse({ id: 42 }).success, false);
  assert.equal(progressResponseSchema.safeParse({ document: null, pages: null }).success, false);
  assert.equal(uploadMetadataSchema.safeParse({ subject: {}, grade: "", sourceExamType: "", sourceRegion: "", sourceTextbook: "", sourceSchool: "", sourceYear: NaN }).success, false);
});
