import test from "node:test";
import assert from "node:assert/strict";
import { parseVariationPlan, parseVariationVerification } from "../lib/variation-plan.ts";
import { boundedText, parseVariationModelContent, parseVariationReviewContent } from "../lib/question-variations.ts";

test('模型 JSON 把 LaTeX 误转成控制字符时拒绝保存，正常换行缩进仍可用',()=>{
 const question={type:'fill',stem:'计算新函数值。',options:[],answer:'1',analysis:'代入求解。',tags:[],changeNote:'修改条件。',diagram:null};
 const parse=q=>parseVariationModelContent({content:JSON.stringify({variations:[q]}),count:1,sourceType:'fill',sourceStem:'计算原函数值。',allowedTags:[],fallbackTags:[]});
 for(const control of ['\b','\f','\u000b','\u001b','\u007f']){
  for(const field of ['stem','answer','analysis','changeNote'])assert.throws(()=>parse({...question,[field]:`数学${control}公式`}),/JSON 转义/);
  assert.throws(()=>boundedText(`${control}开头`,100),/控制字符/);
 }
 assert.equal(boundedText('第一步\r\n\t第二步 $\\beta$',100),'第一步\r\n\t第二步 $\\beta$');
 assert.equal(parse({...question,analysis:'由 $\\beta=1$。\n代入得 1。'})[0].answer,'1');
});

test("命题计划必须覆盖所有候选，最终复核对缺失、重复、否定和伪布尔值关闭通过", () => {
  const plan = { objective: "一次方程", prerequisites: "等式", difficultyRationale: "一步求解", misconception: "移项符号", changes: ["逆向", "情境"] };
  assert.deepEqual(parseVariationPlan(JSON.stringify(plan), 1), plan);
  assert.throws(() => parseVariationPlan(JSON.stringify({ ...plan, changes: [] }), 1));
  const check = { index: 1, score: 90, solvable: true, answerCorrect: true, objectiveAligned: true, difficultyAligned: true, explanation: "代入满足等式" };
  assert.equal(parseVariationVerification(JSON.stringify({ checks: [check] }), 1).length, 1);
  for (const checks of [[], [check, check], [{ ...check, solvable: false }], [{ ...check, answerCorrect: "true" }], [{ ...check, explanation: "" }]]) assert.throws(() => parseVariationVerification(JSON.stringify({ checks }), 1));
});

test("选择题必须连续编号且答案引用真实选项", () => {
  const question = { type: "single", stem: "2+2=?", options: [{ key: "A", content: "3" }, { key: "B", content: "4" }], answer: "B", analysis: "2+2=4", tags: [] };
  const parse = q => parseVariationModelContent({ content: JSON.stringify({ variations: [q] }), count: 1, sourceType: q.type, sourceStem: "1+1=?", allowedTags: [], fallbackTags: [] });
  assert.equal(parse(question).length, 1);
  for (const answer of ["C", "AB", "答案为B"]) assert.throws(() => parse({ ...question, answer }));
  assert.throws(() => parse({ ...question, options: [{ key: "B", content: "3" }, { key: "C", content: "4" }] }));
  assert.throws(() => parse({ ...question, type: "multiple", answer: "B" }));
});


test("最终评分保持 75 分门槛，不接受缺失、占位、越界和小数分数", () => {
  const check = { index: 1, score: 75, solvable: true, answerCorrect: true, objectiveAligned: true, difficultyAligned: true, explanation: "逐项复算通过" };
  const parse = score => parseVariationVerification(JSON.stringify({ checks: [{ ...check, score }] }), 1);
  assert.equal(parse(75)[0].score, 75);
  assert.equal(parse(100)[0].score, 100);
  for (const score of [undefined, null, "90", "实际整数", 0, 74, -1, 101, 90.5]) assert.throws(() => parse(score));
  for (const key of ["solvable", "answerCorrect", "objectiveAligned", "difficultyAligned"]) {
    assert.throws(() => parseVariationVerification(JSON.stringify({ checks: [{ ...check, score: 100, [key]: false }] }), 1));
  }
});

test("修订轮的旧 0 分不阻止修订，但不会被改成及格分或直接放行", () => {
  const question = { type: "fill", stem: "求 2+2 的值。", options: [], answer: "4", analysis: "2+2=4", tags: [], changeNote: "改变数值", diagram: null };
  const input = { content: JSON.stringify({ reviews: [{ index: 1, verdict: "revise", score: 0, issues: ["修正答案"], finalVariation: question }] }), candidates: [{ ...question, answer: "5" }], sourceType: "fill", sourceStem: "求 1+1 的值。", allowedTags: [], fallbackTags: [], reviewer: "test" };
  assert.throws(() => parseVariationReviewContent(input), /75/);
  const revised = parseVariationReviewContent({ ...input, deferScoring: true });
  assert.equal(revised.variations[0].answer, "4");
  assert.equal(revised.reviews[0].score, null);
  assert.equal(revised.reviews[0].status, "revised");
});
