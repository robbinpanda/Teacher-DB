import assert from "node:assert/strict";
import test from "node:test";
import { persistDirtyQuestionDrafts } from "../lib/review-draft-persistence.ts";

test("自动入库前会依次保存所有改过的题框，并保留最新框选数据", async () => {
  const questions = [
    { id: "q1", regions: [{ page: 1, bbox: { x: 2, y: 3, width: 40, height: 20 } }] },
    { id: "q2", regions: [{ page: 1, bbox: { x: 5, y: 6, width: 50, height: 30 } }] },
    { id: "q3", regions: [{ page: 2, bbox: { x: 8, y: 9, width: 60, height: 40 } }] },
  ];
  const saved = [];
  const ids = await persistDirtyQuestionDrafts({
    questions,
    dirtyQuestionIds: new Set(["q1", "q3"]),
    persist: async (question) => saved.push(structuredClone(question)),
  });
  assert.deepEqual(ids, ["q1", "q3"]);
  assert.deepEqual(saved.map((question) => question.regions[0].bbox), [
    { x: 2, y: 3, width: 40, height: 20 },
    { x: 8, y: 9, width: 60, height: 40 },
  ]);
});

test("任一道草稿保存失败时立即停止，不能继续自动入库", async () => {
  const attempted = [];
  await assert.rejects(() => persistDirtyQuestionDrafts({
    questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
    dirtyQuestionIds: new Set(["q1", "q2", "q3"]),
    persist: async (question) => {
      attempted.push(question.id);
      if (question.id === "q2") throw new Error("题框保存失败");
    },
  }), /题框保存失败/);
  assert.deepEqual(attempted, ["q1", "q2"]);
});
