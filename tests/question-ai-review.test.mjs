import test from "node:test";
import assert from "node:assert/strict";
import { createQuestionReview, createQuestionReviewQueue, parseQuestionReview, questionReviewText, questionReviewContentKey,
  QUESTION_REVIEW_PROMPT, QUESTION_REVIEW_MAX_TOKENS } from "../lib/question-ai-review.ts";
import { wholeDocumentSystemPrompt } from "../lib/document-extraction.ts";
import { buildVisionHttpRequest } from "../lib/model-protocols.ts";

const question = { id: "q", number: "2", type: "answer", stem: "当前题", options: [], answer: "答案", analysis: "解析",
  page: 2, bbox: {}, assets: [], needsHumanReview: false, tags: [], confidence: 0.98 };

test("严格接受通过或多类问题，其他问题不是不确定的替代", () => {
  assert.deepEqual(parseQuestionReview(" 没问题\n"), { status: "passed", categories: [] });
  assert.deepEqual(parseQuestionReview("缺图、缺条件、答案错误、缺图"), { status: "issues", categories: ["缺图", "缺条件", "答案错误"] });
  assert.deepEqual(parseQuestionReview("其他问题"), { status: "issues", categories: ["其他问题"] });
  for (const reply of ["", "有问题", "不确定", "没有问题", "没问题。", '{"有问题":false}', "没问题、缺图", "缺图：图片没了", "true"]) assert.throws(() => parseQuestionReview(reply));
  assert.ok(QUESTION_REVIEW_PROMPT.length < 350);
  assert.match(wholeDocumentSystemPrompt, /不要输出 confidence/);
  assert.doesNotMatch(wholeDocumentSystemPrompt, /confidence 必须|tags、confidence、needsHumanReview/);
});

test("独立会话只含保存内容，不传原卷页码、模型自评或其他题目", () => {
  const text = questionReviewText({ ...question, unrelatedQuestions: [{ stem: "另一题" }] });
  assert.match(text, /当前题/);
  assert.doesNotMatch(text, /另一题|confidence|0\.98|sourcePages|answerPages|imageBoundsUnit/);
  assert.equal(questionReviewContentKey(question), questionReviewContentKey({ ...question, tags: ["新标签"], confidence: 0.1 }));
  assert.notEqual(questionReviewContentKey(question), questionReviewContentKey({ ...question, stem: "已修正" }));
});

test("解析图片标记按答案图排序，不混用全部配图的序号", () => {
  const input = JSON.parse(questionReviewText({ ...question, analysis: "步骤一[[image:1]]步骤二[[image:2]]", assets: [
    { role: "question", kind: "figure", label: "题图" },
    { role: "answer", kind: "figure", label: "辅助线" },
    { role: "question", kind: "table", label: "数据表" },
    { role: "answer", kind: "figure", label: "坐标图" },
  ] }));
  assert.equal(input.assets[0].analysisMarker, undefined);
  assert.equal(input.assets[1].index, 2);
  assert.equal(input.assets[1].analysisMarker, "[[image:1]]");
  assert.equal(input.assets[3].analysisMarker, "[[image:2]]");
});

test("跨页证据由独立PDF题号补全，题目页与答案页分开且去重", () => {
  const inventory = { questions: [{ number: "1", firstLinePage: 1 }, { number: "2", firstLinePage: 2 }, { number: "3", firstLinePage: 4 }],
    answers: [{ number: "1", firstLinePage: 5 }, { number: "2", firstLinePage: 6 }, { number: "3", firstLinePage: 9 }] };
  const review = createQuestionReview(question, { sourcePages: [2, 2, 99], answerPages: [6, -1] }, 10, "profile", inventory);
  assert.deepEqual(review.sourcePages, [2, 3, 4]); assert.deepEqual(review.answerPages, [6, 7, 8, 9]);
  assert.equal(review.status, "pending"); assert.equal(review.priorNeedsHumanReview, false);
});

test("并发最多两个，一个请求失败不取消其他题目", async () => {
  const queue = createQuestionReviewQueue(2);
  let running = 0, maximum = 0, finished = 0;
  for (let index = 0; index < 7; index++) queue.add(async () => {
    running++; maximum = Math.max(maximum, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--; finished++;
    if (index === 2) throw new Error("单题失败");
  });
  const results = await queue.drain();
  assert.equal(maximum, 2); assert.equal(finished, 7);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});

test("三种提供商协议均限制审核输出，独立单轮请求", () => {
  for (const protocol of ["openai-chat-completions", "openai-responses", "anthropic-messages"]) {
    const { body } = buildVisionHttpRequest({ protocol, baseUrl: "https://example.com/v1", model: "fixture", apiKey: "test",
      system: QUESTION_REVIEW_PROMPT, text: questionReviewText(question), images: [{ page: 2, dataUrl: "data:image/png;base64,AAAA" }],
      maxOutputTokens: QUESTION_REVIEW_MAX_TOKENS });
    assert.equal(body.max_tokens ?? body.max_output_tokens, 64);
    assert.equal(body.previous_response_id, undefined);
    assert.equal(body.stream, undefined);
  }
});

test("三种协议都支持纯文本审核及保存配图标签", () => {
  for (const protocol of ["openai-chat-completions", "openai-responses", "anthropic-messages"]) {
    const args = { protocol, baseUrl: "https://example.com/v1", model: "fixture", apiKey: "test", system: "audit", text: "题目", images: [] };
    const plain = buildVisionHttpRequest(args).body;
    assert.doesNotMatch(JSON.stringify(plain), /image_url|input_image|base64/);
    const withCrop = buildVisionHttpRequest({ ...args, images: [{ page: 1, label: "已保存配图 1", dataUrl: "data:image/png;base64,AAAA" }] }).body;
    assert.match(JSON.stringify(withCrop), /已保存配图 1/);
    assert.doesNotMatch(JSON.stringify(withCrop), /原试卷/);
  }
});
