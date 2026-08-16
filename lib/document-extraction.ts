import type { BoundingBox, Question, QuestionAsset, QuestionType } from "./types";

export const wholeDocumentSystemPrompt = [
  "你是中文试卷视觉结构化专家。你会一次收到同一份试卷的全部页面，图片前都有原卷页码。必须通读全卷后再一次性返回完整结果。",
  "只能抄录页面中确实可见的内容，禁止凭常识补写；题干、选项、答案、解析必须分开。行内及独立数学表达式转为 LaTeX，并用单个 $ 包裹。",
  "以整道顶层阿拉伯数字题号为单位输出 questions。（1）（2）等小问必须合并到所属大题，不得另建题目；跨页内容要完整合并，不能因换页截断。",
  "每题直接返回 answer 与 analysis。答案页或解析页里的条目必须关联原题号，绝不能伪造成新题。看不清或没有答案、解析时返回空字符串。",
  "不要输出题目整体范围、题干范围或答案整体范围，也不要输出 regions。题目的页面范围由教师后续手工框选，支持跨页。",
  "sourcePages 只列出题目/选项本身实际出现的原卷页码，不要把仅有答案或解析的页码放进去。",
  "assets 只框必须保留为图片的几何图、函数图象、统计图、地图、实验装置、无法可靠转写的表格等。bbox 使用相对单页的 0-100 百分比坐标，并紧贴图片本身。",
  "每个 asset 必须标记 role：题干或选项中的图片写 question；只出现在答案或解析中的图片写 answer。答案图不得写成 question。kind 只能是 figure、table、graph。",
  "type 只能是 single、multiple、fill、answer。tags 只能逐字使用提示给出的允许标签，最多 3 个。needsHumanReview 必须是布尔值；文字缺失、答案不完整、关联或框选存疑时必须为 true。",
  "number 只写不带前导零的正整数题号。所有题号必须从 1 开始连续；输出前逐页复核，确保没有漏题、重题或把解析小标题当成题号。",
  "不要输出 Markdown、说明或代码围栏，只输出严格 JSON。",
  "JSON 格式：",
  "{\"documentMeta\":{\"subject\":\"数学\",\"grade\":\"九年级\",\"year\":2026,\"examType\":\"二模\",\"region\":\"上海市徐汇区\",\"school\":\"\"},\"questions\":[{\"number\":\"1\",\"type\":\"single\",\"stem\":\"题干，公式如 $x^2$\",\"options\":[{\"key\":\"A\",\"content\":\"选项\"}],\"answer\":\"答案\",\"analysis\":\"解析\",\"sourcePages\":[1],\"assets\":[{\"role\":\"question\",\"kind\":\"figure\",\"label\":\"几何图\",\"page\":1,\"bbox\":{\"x\":55,\"y\":20,\"width\":25,\"height\":12}},{\"role\":\"answer\",\"kind\":\"figure\",\"label\":\"解析辅助图\",\"page\":8,\"bbox\":{\"x\":50,\"y\":30,\"width\":30,\"height\":20}}],\"tags\":[\"允许标签之一\"],\"confidence\":0.95,\"needsHumanReview\":false}]} ",
].join("\n");

export type WholeDocumentExtraction = {
  questions: Question[];
  documentMeta: Record<string, unknown>;
  diagnostics: {
    acceptedQuestionNumbers: string[];
    discardedQuestionNumbers: string[];
    missingQuestionNumbers: number[];
  };
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function modelNeedsHumanReview(value: unknown) {
  return value !== false;
}

function isValidQuestionNumber(value: string) {
  return /^[1-9]\d*$/.test(value);
}

function hasExplicitBox(value: unknown) {
  const box = objectValue(value);
  return Boolean(box)
    && [box?.x, box?.y, box?.width, box?.height].every((part) => Number.isFinite(Number(part)))
    && Number(box?.width) > 0 && Number(box?.height) > 0;
}

export function safeExtractionBox(value: unknown): BoundingBox {
  const box = objectValue(value);
  const x = Math.max(0, Math.min(99.9, Number(box?.x ?? 0)));
  const y = Math.max(0, Math.min(99.9, Number(box?.y ?? 0)));
  return {
    x,
    y,
    width: Math.max(0.1, Math.min(100 - x, Number(box?.width ?? 10))),
    height: Math.max(0.1, Math.min(100 - y, Number(box?.height ?? 10))),
  };
}

export function parseExtractionJson(content: string) {
  let clean = content.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (clean.startsWith(fence)) clean = clean.slice(clean.indexOf("\n") + 1);
  if (clean.endsWith(fence)) clean = clean.slice(0, -3).trim();
  try {
    return JSON.parse(clean) as unknown;
  } catch (firstError) {
    const repaired = clean.replace(/(?<!\\)\\(?!["\\])/g, "\\\\");
    if (repaired === clean) throw firstError;
    return JSON.parse(repaired) as unknown;
  }
}

function distinctPages(value: unknown, pageCount: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(Number).filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)))
    .sort((left, right) => left - right);
}

function missingNumbers(numbers: string[]) {
  const numeric = Array.from(new Set(numbers.map(Number))).sort((left, right) => left - right);
  const maximum = numeric.at(-1) ?? 0;
  const present = new Set(numeric);
  return Array.from({ length: maximum }, (_, index) => index + 1).filter((number) => !present.has(number));
}

export function normalizeWholeDocumentExtraction(
  raw: unknown,
  input: { pageCount: number; allowedTags: string[] },
): WholeDocumentExtraction {
  const result = objectValue(raw);
  if (!result || !Array.isArray(result.questions)) throw new Error("模型结果缺少 questions 数组");
  const allowedTags = new Set(input.allowedTags);
  const discardedQuestionNumbers: string[] = [];
  const seenNumbers = new Set<string>();
  const questions = result.questions.flatMap((value, questionIndex): Question[] => {
    const item = objectValue(value);
    const number = String(item?.number ?? "").trim();
    if (!item || !isValidQuestionNumber(number) || seenNumbers.has(number)) {
      discardedQuestionNumbers.push(number || `item-${questionIndex + 1}`);
      return [];
    }
    const rawAssets = Array.isArray(item.assets) ? item.assets : [];
    const assets = rawAssets.flatMap((value): QuestionAsset[] => {
      const asset = objectValue(value);
      const page = Number(asset?.page);
      if (!asset || !Number.isInteger(page) || page < 1 || page > input.pageCount || !hasExplicitBox(asset.bbox)) return [];
      return [{
        id: crypto.randomUUID(),
        role: asset.role === "answer" ? "answer" : "question",
        kind: (["figure", "table", "graph"].includes(String(asset.kind)) ? String(asset.kind) : "figure") as QuestionAsset["kind"],
        label: String(asset.label ?? (asset.role === "answer" ? "答案图" : "题图")).slice(0, 80),
        page,
        bbox: safeExtractionBox(asset.bbox),
      }];
    });
    const questionAssetPage = assets.find((asset) => asset.role === "question")?.page;
    const sourcePages = distinctPages(item.sourcePages, input.pageCount);
    const page = sourcePages[0] ?? questionAssetPage ?? 1;
    const type = (["single", "multiple", "fill", "answer"].includes(String(item.type)) ? String(item.type) : "answer") as QuestionType;
    const needsHumanReview = modelNeedsHumanReview(item.needsHumanReview);
    const confidence = Math.max(0, Math.min(1, Number(item.confidence ?? 0)));
    const placeholder = { x: 5, y: 5, width: 90, height: 20 };
    seenNumbers.add(number);
    return [{
      id: crypto.randomUUID(),
      number,
      type,
      stem: String(item.stem ?? ""),
      options: Array.isArray(item.options) ? item.options.flatMap((value) => {
        const option = objectValue(value);
        return option ? [{ key: String(option.key ?? ""), content: String(option.content ?? "") }] : [];
      }) : [],
      answer: String(item.answer ?? ""),
      analysis: String(item.analysis ?? ""),
      page,
      bbox: placeholder,
      regions: [],
      assets,
      tags: Array.isArray(item.tags)
        ? Array.from(new Set(item.tags.map(String).filter((tag) => allowedTags.has(tag)))).slice(0, 3)
        : [],
      confidence,
      needsHumanReview,
      status: needsHumanReview ? "needs_attention" : "pending",
    }];
  });
  if (!questions.length) throw new Error("模型没有返回任何有效题目");
  questions.sort((left, right) => Number(left.number) - Number(right.number));
  const acceptedQuestionNumbers = questions.map((question) => question.number);
  const missingQuestionNumbers = missingNumbers(acceptedQuestionNumbers);
  if (missingQuestionNumbers.length) {
    throw new Error(`整卷题号不连续，缺少第 ${missingQuestionNumbers.join("、")} 题`);
  }
  return {
    questions,
    documentMeta: objectValue(result.documentMeta) ?? {},
    diagnostics: { acceptedQuestionNumbers, discardedQuestionNumbers, missingQuestionNumbers },
  };
}
