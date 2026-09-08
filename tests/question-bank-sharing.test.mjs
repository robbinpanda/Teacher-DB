import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { assertQuestionFolderMoveDepth } from "../lib/question-folder-rules.ts";
import { validateImportedImage } from "../lib/imported-image.ts";
import { readQuestionPackage } from "../lib/question-package-format.ts";
import {
  parseVariationCandidatePool,
  parseVariationModelContent,
  parseVariationReviewContent,
} from "../lib/question-variations.ts";

function packageBytes(overrides = {}) {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const question = {
    externalId: "question-1",
    parentExternalId: null,
    variationKind: null,
    folderPath: ["高三", "函数"],
    number: "1",
    type: "fill",
    stem: "若 $x=1$，则 $x+1=$____。",
    options: [],
    answer: "2",
    analysis: "代入计算。",
    tags: ["函数"],
    source: {
      documentKey: "document-1",
      documentName: "测试卷.pdf",
      subject: "数学",
      grade: "高三",
      year: 2026,
      examType: "练习",
      region: "上海",
      textbook: "人教A版",
      school: null,
    },
    assets: [{
      kind: "figure",
      role: "question",
      label: "题图",
      mimeType: "image/png",
      data: png.toString("base64"),
      sha256: createHash("sha256").update(png).digest("hex"),
    }],
    ...(overrides.question ?? {}),
  };
  return gzipSync(Buffer.from(JSON.stringify({
    format: "jianti-question-bank",
    schemaVersion: 1,
    packageId: "package-1",
    title: "共享题库",
    exportedAt: new Date().toISOString(),
    questionCount: 1,
    questions: [question],
    ...overrides.root,
  })));
}

test("共享包校验接受结构正确且图片签名匹配的包", () => {
  const value = readQuestionPackage(packageBytes());
  assert.equal(value.questionCount, 1);
  assert.equal(value.questions[0].assets[0].mimeType, "image/png");
});

test("共享包拒绝伪装成图片的任意内容，即使哈希正确", () => {
  const fake = Buffer.from("<script>alert(1)</script>");
  assert.throws(() => readQuestionPackage(packageBytes({ question: { assets: [{
    kind: "figure",
    role: "question",
    label: "伪装图片",
    mimeType: "image/png",
    data: fake.toString("base64"),
    sha256: createHash("sha256").update(fake).digest("hex"),
  }] } })), /图片内容与声明格式不一致/);
});

test("导入落盘前会实际解码图片并拒绝只有文件头的截断内容", async () => {
  const realPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  assert.deepEqual(await validateImportedImage(realPng, "image/png"), { width: 1, height: 1, format: "png" });
  const headerOnly = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await assert.rejects(() => validateImportedImage(headerOnly, "image/png"), /无法解码|已损坏/);
});

test("共享包不会静默截断超量选项和目录层级", () => {
  const options = Array.from({ length: 9 }, (_, index) => ({ key: String(index + 1), content: "选项" }));
  assert.throws(() => readQuestionPackage(packageBytes({ question: { options } })), /选项过多/);
  assert.throws(() => readQuestionPackage(packageBytes({ question: { folderPath: Array(9).fill("目录") } })), /超过 8 层/);
});

test("移动文件夹时同时计算父路径和整个子树深度", () => {
  assert.doesNotThrow(() => assertQuestionFolderMoveDepth(5, 3));
  assert.throws(() => assertQuestionFolderMoveDepth(6, 3), /超过 8 层/);
});

const validVariations = {
  variations: [
    { stem: "若 x=2，则 x+1 等于多少？", type: "single", options: [{ key: "A", content: "2" }, { key: "B", content: "3" }], answer: "B", analysis: "代入。", tags: ["函数"], changeNote: "改变数值" },
    { stem: "若 x=3，则 2x 等于多少？", type: "single", options: [{ key: "A", content: "5" }, { key: "B", content: "6" }], answer: "B", analysis: "计算。", tags: ["函数"], changeNote: "改变运算" },
  ],
};

function parseVariations(value = validVariations, count = 2) {
  return parseVariationModelContent({
    content: JSON.stringify(value),
    count,
    sourceType: "single",
    sourceStem: "若 x=1，则 x+1 等于多少？",
    allowedTags: ["函数", "方程"],
    fallbackTags: ["函数"],
  });
}

test("变式题校验要求模型返回足量、互不重复的完整题目", () => {
  assert.equal(parseVariations().length, 2);
  assert.throws(() => parseVariations({ variations: [validVariations.variations[0]] }), /少于要求的 2 道/);
  assert.throws(() => parseVariations({ variations: [validVariations.variations[0], validVariations.variations[0]] }), /重复/);
});

test("变式题校验拒绝重复选项序号和空答案", () => {
  const duplicateOptions = structuredClone(validVariations);
  duplicateOptions.variations[0].options[1].key = "A";
  assert.throws(() => parseVariations(duplicateOptions), /重复选项序号/);
  const missingAnswer = structuredClone(validVariations);
  missingAnswer.variations[0].answer = "";
  assert.throws(() => parseVariations(missingAnswer), /字段不完整/);
});

test("变式候选池会跳过坏候选，并从冗余候选中补足数量", () => {
  const invalid = structuredClone(validVariations.variations[0]);
  invalid.options[1].content = invalid.options[0].content;
  const third = { stem: "若 x=4，则 x-1 等于多少？", type: "single", options: [{ key: "A", content: "2" }, { key: "B", content: "3" }], answer: "B", analysis: "代入计算。", tags: ["函数"], changeNote: "改变数值和运算" };
  const result = parseVariationCandidatePool({
    content: JSON.stringify({ variations: [invalid, ...validVariations.variations, third] }),
    targetCount: 2,
    sourceType: "single",
    sourceStem: "若 x=1，则 x+1 等于多少？",
    allowedTags: ["函数"],
    fallbackTags: ["函数"],
  });
  assert.equal(result.variations.length, 2);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0], /重复选项内容/);
});

test("变式题规则校验拒绝非选择题选项和未闭合 LaTeX", () => {
  const fillWithOptions = { variations: [{ ...validVariations.variations[0], type: "fill" }] };
  assert.throws(() => parseVariationModelContent({
    content: JSON.stringify(fillWithOptions), count: 1, sourceType: "fill", sourceStem: "原填空题",
    allowedTags: ["函数"], fallbackTags: ["函数"],
  }), /非选择题不应包含选项/);
  const brokenMath = structuredClone(validVariations);
  brokenMath.variations[0].analysis = "代入 $x=2 后计算。".slice(0, -1);
  assert.throws(() => parseVariations(brokenMath), /未闭合的 LaTeX/);
});

test("独立审校结果必须逐题对齐、达到入库线，并保留修订记录", () => {
  const candidates = parseVariations();
  const revisedSecond = { ...candidates[1], stem: "若 x=3，则 3x 等于多少？", options: [{ key: "A", content: "6" }, { key: "B", content: "9" }], answer: "B", analysis: "3×3=9。" };
  const result = parseVariationReviewContent({
    content: JSON.stringify({ reviews: [
      { index: 1, verdict: "pass", score: 92, issues: [], finalVariation: candidates[0] },
      { index: 2, verdict: "revise", score: 88, issues: ["原选项区分度不足"], finalVariation: revisedSecond },
    ] }),
    candidates,
    sourceType: "single",
    sourceStem: "若 x=1，则 x+1 等于多少？",
    allowedTags: ["函数", "方程"],
    fallbackTags: ["函数"],
    reviewer: "审校模型",
  });
  assert.deepEqual(result.reviews.map((review) => review.status), ["passed", "revised"]);
  assert.equal(result.reviews[1].reviewer, "审校模型");
  assert.equal(result.variations[1].answer, "B");

  const lowScore = { reviews: [{ index: 1, verdict: "pass", score: 74, issues: [], finalVariation: candidates[0] }, { index: 2, verdict: "pass", score: 90, issues: [], finalVariation: candidates[1] }] };
  assert.throws(() => parseVariationReviewContent({
    content: JSON.stringify(lowScore), candidates, sourceType: "single", sourceStem: "原题",
    allowedTags: ["函数"], fallbackTags: ["函数"], reviewer: "审校模型",
  }), /未达到 75 分入库线/);
});

test("共享包可以携带审校出处，但拒绝伪造的越界评分", () => {
  const valid = readQuestionPackage(packageBytes({ question: { variationReview: { mode: "multi_agent", status: "passed", score: 91, issues: [], reviewer: "审校模型" } } }));
  assert.equal(valid.questions[0].variationReview?.score, 91);
  assert.throws(() => readQuestionPackage(packageBytes({ question: { variationReview: { mode: "multi_agent", status: "passed", score: 120, issues: [], reviewer: "审校模型" } } })), /审校记录无效/);
});

test("共享包拒绝同卷重复题号和互相冲突的来源信息", () => {
  const base = readQuestionPackage(packageBytes()).questions[0];
  const duplicate = { ...structuredClone(base), externalId: "question-2" };
  assert.throws(() => readQuestionPackage(packageBytes({ root: {
    questionCount: 2,
    questions: [base, duplicate],
  } })), /重复题号/);

  const conflicting = {
    ...structuredClone(base),
    externalId: "question-2",
    number: "2",
    source: { ...base.source, grade: "高二" },
  };
  assert.throws(() => readQuestionPackage(packageBytes({ root: {
    questionCount: 2,
    questions: [base, conflicting],
  } })), /冲突的试卷信息/);
});

test("共享包父题关系与题目排列顺序无关，但拒绝自引用和循环", () => {
  const base = readQuestionPackage(packageBytes()).questions[0];
  const child = {
    ...structuredClone(base),
    externalId: "question-2",
    parentExternalId: base.externalId,
    number: "2",
    variationKind: "数值变式",
  };
  const childFirst = readQuestionPackage(packageBytes({ root: {
    questionCount: 2,
    questions: [child, base],
  } }));
  assert.equal(childFirst.questions[0].parentExternalId, "question-1");

  const generatedChild = {
    ...structuredClone(child),
    source: { ...child.source, documentKey: "generated-document", documentName: "AI 变式 · 测试卷.pdf" },
  };
  const crossSource = readQuestionPackage(packageBytes({ root: {
    questionCount: 2,
    questions: [base, generatedChild],
  } }));
  assert.equal(crossSource.questions[1].parentExternalId, "question-1");

  assert.throws(() => readQuestionPackage(packageBytes({ question: { parentExternalId: "question-1" } })), /自身声明为原题/);
  const cyclicRoot = { ...structuredClone(base), parentExternalId: "question-2" };
  assert.throws(() => readQuestionPackage(packageBytes({ root: {
    questionCount: 2,
    questions: [cyclicRoot, child],
  } })), /形成了循环/);
});
