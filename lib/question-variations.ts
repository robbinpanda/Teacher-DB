import type { QuestionType, VariationReview } from "./types";
import { parseQuestionDiagram, type QuestionDiagram } from "./question-diagrams.ts";

function objectValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function boundedText(value: unknown, limit: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > limit || /\u0000/.test(text)) {
    throw new Error("变式题字段不完整、包含无效字符或长度超限");
  }
  return text;
}

function comparableStem(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s，。！？；：、,.!?;:'"“”‘’（）()【】\[\]]+/g, "");
}

function hasBalancedMathDelimiters(value: string) {
  const dollars = value.match(/(?<!\\)\$/g)?.length ?? 0;
  return dollars % 2 === 0;
}

export type ValidatedVariation = {
  type: QuestionType;
  stem: string;
  options: Array<{ key: string; content: string }>;
  answer: string;
  analysis: string;
  tags: string[];
  changeNote: string;
  diagram: QuestionDiagram | null;
};

export function parseVariationModelContent(input: {
  content: string;
  count: number;
  sourceType: QuestionType;
  sourceStem: string;
  allowedTags: string[];
  fallbackTags: string[];
  allowDiagrams?: boolean;
}): ValidatedVariation[] {
  const normalized = input.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(normalized) as unknown; }
  catch { throw new Error("模型没有返回有效的 JSON 变式题"); }
  const root = objectValue(parsed);
  const rawVariations = Array.isArray(root?.variations) ? root.variations : [];
  if (rawVariations.length < input.count) throw new Error(`模型仅返回 ${rawVariations.length} 道有效候选，少于要求的 ${input.count} 道，请重试`);
  const allowed = new Set(input.allowedTags);
  const fallbackTags = input.fallbackTags.filter((tag) => allowed.has(tag)).slice(0, 3);
  const seenStems = new Set([comparableStem(input.sourceStem)]);
  return rawVariations.slice(0, input.count).map((raw, index) => {
    const value = objectValue(raw);
    if (!value) throw new Error(`模型返回的第 ${index + 1} 道变式题结构无效`);
    const type = String(value.type ?? input.sourceType) as QuestionType;
    if (type !== input.sourceType) throw new Error(`第 ${index + 1} 道变式题的题型与原题不一致`);
    if (Array.isArray(value.options) && value.options.length > 8) throw new Error(`第 ${index + 1} 道变式题选项超过 8 个`);
    const options = Array.isArray(value.options) ? value.options.map((option) => {
      const item = objectValue(option);
      return { key: boundedText(item?.key, 4, true), content: boundedText(item?.content, 2000, true) };
    }) : [];
    if ((type === "single" || type === "multiple") && options.length < 2) throw new Error(`第 ${index + 1} 道选择题缺少有效选项`);
    if (type !== "single" && type !== "multiple" && options.length) throw new Error(`第 ${index + 1} 道非选择题不应包含选项`);
    if (new Set(options.map((option) => option.key.toLocaleUpperCase())).size !== options.length) {
      throw new Error(`第 ${index + 1} 道变式题包含重复选项序号`);
    }
    if (new Set(options.map((option) => comparableStem(option.content))).size !== options.length) {
      throw new Error(`第 ${index + 1} 道变式题包含重复选项内容`);
    }
    const stem = boundedText(value.stem, 12000, true);
    const stemKey = comparableStem(stem);
    if (!stemKey || seenStems.has(stemKey)) throw new Error(`第 ${index + 1} 道变式题与原题或其他变式重复`);
    seenStems.add(stemKey);
    const tags = Array.isArray(value.tags)
      ? Array.from(new Set(value.tags.map(String).filter((tag) => allowed.has(tag)))).slice(0, 3)
      : fallbackTags;
    const answer = boundedText(value.answer, 6000, true);
    const analysis = boundedText(value.analysis, 12000, true);
    if (input.allowDiagrams === false && value.diagram !== undefined && value.diagram !== null) {
      throw new Error(`第 ${index + 1} 道变式题在“无需题图”模式下返回了题图`);
    }
    const diagram = input.allowDiagrams === false ? null : parseQuestionDiagram(value.diagram);
    if (!diagram && /(?:如|见|根据)(?:下|右|左)?图|图中|图示/.test(stem)) {
      throw new Error(`第 ${index + 1} 道变式题引用了题图，但没有返回可渲染的题图数据`);
    }
    if (![stem, answer, analysis, ...options.map((option) => option.content)].every(hasBalancedMathDelimiters)) {
      throw new Error(`第 ${index + 1} 道变式题包含未闭合的 LaTeX 数学分隔符`);
    }
    return {
      type,
      stem,
      options,
      answer,
      analysis,
      tags: tags.length ? tags : fallbackTags,
      changeNote: boundedText(value.changeNote, 300) || "调整题目条件与设问方式",
      diagram,
    };
  });
}

export function parseVariationCandidatePool(input: {
  content: string;
  targetCount: number;
  sourceType: QuestionType;
  sourceStem: string;
  allowedTags: string[];
  fallbackTags: string[];
  allowDiagrams?: boolean;
}) {
  const normalized = input.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(normalized) as unknown; }
  catch { throw new Error("生成 Agent 没有返回有效 JSON"); }
  const root = objectValue(parsed);
  const rawVariations = Array.isArray(root?.variations) ? root.variations.slice(0, input.targetCount + 2) : [];
  const accepted: ValidatedVariation[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  rawVariations.forEach((raw, index) => {
    try {
      const [candidate] = parseVariationModelContent({
        content: JSON.stringify({ variations: [raw] }),
        count: 1,
        sourceType: input.sourceType,
        sourceStem: input.sourceStem,
        allowedTags: input.allowedTags,
        fallbackTags: input.fallbackTags,
        allowDiagrams: input.allowDiagrams,
      });
      const key = comparableStem(candidate.stem);
      if (seen.has(key)) throw new Error("与本批其他候选题重复");
      seen.add(key);
      accepted.push(candidate);
    } catch (error) {
      rejected.push(`候选 ${index + 1}：${error instanceof Error ? error.message : "结构无效"}`);
    }
  });
  if (accepted.length < input.targetCount) {
    throw new Error(`生成 Agent 返回 ${accepted.length} 道合格候选，少于要求的 ${input.targetCount} 道。${rejected.slice(0, 2).join("；")}`);
  }
  return { variations: accepted.slice(0, input.targetCount), rejected };
}

export function parseVariationReviewContent(input: {
  content: string;
  candidates: ValidatedVariation[];
  sourceType: QuestionType;
  sourceStem: string;
  allowedTags: string[];
  fallbackTags: string[];
  reviewer: string;
  allowDiagrams?: boolean;
}) {
  const normalized = input.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(normalized) as unknown; }
  catch { throw new Error("审校 Agent 没有返回有效 JSON"); }
  const root = objectValue(parsed);
  const rawReviews = Array.isArray(root?.reviews) ? root.reviews : [];
  if (rawReviews.length !== input.candidates.length) {
    throw new Error(`审校 Agent 返回 ${rawReviews.length} 条结果，与 ${input.candidates.length} 道候选题不一致`);
  }
  const byIndex = new Map<number, { finalVariation: unknown; review: Omit<VariationReview, "reviewer"> }>();
  rawReviews.forEach((raw, position) => {
    const item = objectValue(raw);
    if (!item) throw new Error(`第 ${position + 1} 条审校结果结构无效`);
    const index = Number(item.index);
    if (!Number.isInteger(index) || index < 1 || index > input.candidates.length || byIndex.has(index)) {
      throw new Error("审校 Agent 返回了重复或越界的题目序号");
    }
    const verdict = String(item.verdict);
    if (verdict !== "pass" && verdict !== "revise") throw new Error(`第 ${index} 道题的审校结论无效`);
    const score = Number(item.score);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error(`第 ${index} 道题的审校分数无效`);
    if (score < 75) throw new Error(`第 ${index} 道题审校后仅 ${score} 分，未达到 75 分入库线`);
    if (!Array.isArray(item.issues) || item.issues.length > 5) throw new Error(`第 ${index} 道题的审校问题列表无效`);
    const issues = item.issues.map((issue) => boundedText(issue, 160, true));
    if (!item.finalVariation) throw new Error(`第 ${index} 道题缺少审校后的最终版本`);
    byIndex.set(index, {
      finalVariation: item.finalVariation,
      review: {
        mode: "multi_agent",
        status: verdict === "revise" ? "revised" : "passed",
        score,
        issues,
      },
    });
  });
  const ordered = Array.from({ length: input.candidates.length }, (_, index) => byIndex.get(index + 1)!);
  const variations = parseVariationModelContent({
    content: JSON.stringify({ variations: ordered.map((item) => item.finalVariation) }),
    count: input.candidates.length,
    sourceType: input.sourceType,
    sourceStem: input.sourceStem,
    allowedTags: input.allowedTags,
    fallbackTags: input.fallbackTags,
    allowDiagrams: input.allowDiagrams,
  });
  const reviews: VariationReview[] = ordered.map((item, index) => {
    const changed = JSON.stringify(input.candidates[index]) !== JSON.stringify(variations[index]);
    return {
      ...item.review,
      status: item.review.status === "revised" || changed ? "revised" : "passed",
      reviewer: input.reviewer,
    };
  });
  return { variations, reviews };
}
