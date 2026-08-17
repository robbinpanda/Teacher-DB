import type { BoundingBox, Question, QuestionAsset, QuestionType } from "./types";
import { stripLeadingQuestionNumber } from "./question-text.js";

export const wholeDocumentSystemPrompt = [
  "你是中文试卷视觉结构化专家。你会一次收到同一份试卷的全部页面，图片前都有原卷页码。必须通读全卷，但结果要按事件逐题流式输出。",
  "只能抄录页面中确实可见的内容，禁止凭常识补写；题干、选项、答案、解析必须分开。行内及独立数学表达式转为 LaTeX，并用单个 $ 包裹。",
  "所有文字字段都必须逐字转录：按原文顺序一个字、一个符号地输出，不得概括、改写、缩写、润色、合并步骤或省略重复内容。尤其 answer 与 analysis 必须完整保留原答案的每个小问、步骤、条件、单位、标点和结论；宁可在看不清处留空并标记 needsHumanReview，也绝不能自行总结。",
  "以整道顶层阿拉伯数字题号为单位输出 questions。（1）（2）等小问必须合并到所属大题，不得另建题目；跨页内容要完整合并，不能因换页截断。",
  "number 单独保存原卷顶层题号；stem 必须从题号后的题干正文开始，开头不得重复输出顶层题号及其点号/顿号，例如原文“1. 已知……”应输出 number=\"1\"、stem=\"已知……\"，绝不能输出 stem=\"1. 已知……\"。只去掉顶层原题号，题内的（1）（2）等小问编号必须完整保留。",
  "每题直接返回 answer 与 analysis。答案页或解析页里的条目必须关联原题号，绝不能伪造成新题。看不清或没有答案、解析时返回空字符串。",
  "不要输出题目整体范围、题干范围或答案整体范围，也不要输出 regions。教师只有在点击重新识别单题时才会按需手工框选。",
  "每题必须输出 firstLinePage，表示该题题号及第一行文字首次出现的原卷页码；sourcePages 列出题目/选项本身实际出现的全部原卷页码，不要把仅有答案或解析的页码放进去。firstLinePage 必须属于 sourcePages。",
  "assets 只框必须保留为图片的几何图、函数图象、统计图、地图、实验装置和所有表格。不要框普通文字、公式或整题范围。",
  "【表格强制截图规则，优先级最高】任何依靠行列、单元格、表头、分隔线或空间位置表达含义的内容，都一律截图保存为 kind=table 的 asset，无论表格多简单、是否能用 LaTeX 表达，都没有例外。包括但不限于：普通数据表、统计表、频数/频率分布表、列联表、茎叶图、课程表、评分表、复杂表头及特殊排版表格。题干/选项中的表格写 role=question，答案/解析中的表格写 role=answer。",
  "严禁在 stem、options、answer、analysis 中生成或保留任何 LaTeX 表格代码，包括但不限于 tabular、array 表格、matrix 表格、\\multicolumn、\\multirow、\\hline、\\cline。表格只能出现一次：输出对应 asset 后，不得再把同一表格转成 LaTeX、Markdown 表格、纯文字行列或逗号列表重复输出；文本字段只逐字转录表格前后的普通文字与公式。普通数学公式、方程组和分段函数仍可使用 LaTeX，但不得借此转写表格。",
  "【其他图表保留规则】函数图象、坐标系、数轴、流程图、示意图、带图标的数据图等空间布局本身承载题意的内容，也必须原样保存为 figure 或 graph asset，不得摊平成普通文字或自行概括。宁可多保留一张必要题图，也不能因转写而丢失视觉信息。",
  "【assets 严格结构，优先级最高】每个 asset 必须且只能包含 role、kind、label、page、bbox。五个字段一个都不能省略；即使 page 与 firstLinePage 相同，也必须在 asset 内再次明确输出 page。",
  "asset.page 必须是该图片实际出现的原卷页码整数，以输入图片前的“下面是原试卷第 N 页”为唯一依据。不要用 firstLinePage 代替，不要猜测；同一道题跨页时，每个 asset 仍只属于一个明确页面。不能确认实际页码时，不要输出该 asset，并把 needsHumanReview 设为 true。",
  "asset.bbox 必须是 JSON 对象 {\"x\":数字,\"y\":数字,\"width\":数字,\"height\":数字}，四项齐全。坐标是相对 asset.page 单页原图的 0-100 百分比：左上角为原点，x 向右、y 向下，width/height 为框的宽高；必须紧贴图片本身且满足 x+width<=100、y+height<=100。",
  "严禁把 bbox 输出成数组，严禁输出 [x1,y1,x2,y2]、x_min/y_min/x_max/y_max、像素坐标或字符串；例如 {\"bbox\":[9,39,35,55]} 是错误格式。正确格式示例：{\"role\":\"question\",\"kind\":\"figure\",\"label\":\"几何图\",\"page\":4,\"bbox\":{\"x\":9,\"y\":39,\"width\":26,\"height\":16}}。",
  "每个 asset 必须标记 role：题干或选项中的图片写 question；只出现在答案或解析中的图片写 answer。答案图不得写成 question。kind 只能是 figure、table、graph。输出每个 question 事件前，逐项检查所有 assets 都有整数 page 和对象形式 bbox；不合格就先修正再输出。",
  "type 只能是 single、multiple、fill、answer。tags 只能逐字使用提示给出的允许标签，最多 3 个。needsHumanReview 必须是布尔值；文字缺失、答案不完整、关联或框选存疑时必须为 true。",
  "number 只写不带前导零的正整数题号。所有题号必须从 1 开始连续；输出前逐页复核，确保没有漏题、重题或把解析小标题当成题号。",
  "不要输出 Markdown、说明、代码围栏或外层数组。每个事件必须是一个独立、完整的 JSON 对象，按以下顺序立即输出：",
  "1. 通读并确认题目总数后，先输出且只输出一个 meta 事件：{\"event\":\"meta\",\"questionCount\":21,\"documentMeta\":{\"subject\":\"数学\",\"grade\":\"九年级\",\"year\":2026,\"examType\":\"二模\",\"region\":\"上海市徐汇区\",\"school\":\"\"}}",
  "2. 然后严格按题号逐题输出 question 事件；每完成一题就立刻输出，不要等全部题目完成：",
  "{\"event\":\"question\",\"question\":{\"number\":\"1\",\"type\":\"single\",\"stem\":\"题干，公式如 $x^2$\",\"options\":[{\"key\":\"A\",\"content\":\"选项\"}],\"answer\":\"逐字转录的答案\",\"analysis\":\"逐字转录的完整解析\",\"firstLinePage\":1,\"sourcePages\":[1],\"assets\":[{\"role\":\"question\",\"kind\":\"figure\",\"label\":\"几何图\",\"page\":1,\"bbox\":{\"x\":55,\"y\":20,\"width\":25,\"height\":12}}],\"tags\":[\"允许标签之一\"],\"confidence\":0.95,\"needsHumanReview\":false}}",
  "3. 所有题目输出后，最后输出：{\"event\":\"done\"}",
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

function normalizeQuestionValue(
  value: unknown,
  input: { pageCount: number; allowedTags: string[] },
): Question {
  const item = objectValue(value);
  const number = String(item?.number ?? "").trim();
  if (!item || !isValidQuestionNumber(number)) throw new Error(`模型返回非法题号：${number || "空值"}`);
  const allowedTags = new Set(input.allowedTags);
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
  const requestedFirstLinePage = Number(item.firstLinePage);
  const page = Number.isInteger(requestedFirstLinePage)
    && requestedFirstLinePage >= 1
    && requestedFirstLinePage <= input.pageCount
    && (!sourcePages.length || sourcePages.includes(requestedFirstLinePage))
    ? requestedFirstLinePage
    : sourcePages[0] ?? questionAssetPage ?? 1;
  const type = (["single", "multiple", "fill", "answer"].includes(String(item.type)) ? String(item.type) : "answer") as QuestionType;
  const needsHumanReview = modelNeedsHumanReview(item.needsHumanReview);
  return {
    id: crypto.randomUUID(),
    number,
    type,
    stem: stripLeadingQuestionNumber(String(item.stem ?? ""), number),
    options: Array.isArray(item.options) ? item.options.flatMap((value) => {
      const option = objectValue(value);
      return option ? [{ key: String(option.key ?? ""), content: String(option.content ?? "") }] : [];
    }) : [],
    answer: String(item.answer ?? ""),
    analysis: String(item.analysis ?? ""),
    page,
    bbox: { x: 5, y: 5, width: 90, height: 20 },
    regions: [],
    assets,
    tags: Array.isArray(item.tags)
      ? Array.from(new Set(item.tags.map(String).filter((tag) => allowedTags.has(tag)))).slice(0, 3)
      : [],
    confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
    needsHumanReview,
    status: needsHumanReview ? "needs_attention" : "pending",
  };
}

export function normalizeStreamedQuestion(
  raw: unknown,
  input: { pageCount: number; allowedTags: string[] },
) {
  return normalizeQuestionValue(raw, input);
}

export function normalizeWholeDocumentExtraction(
  raw: unknown,
  input: { pageCount: number; allowedTags: string[] },
): WholeDocumentExtraction {
  const result = objectValue(raw);
  if (!result || !Array.isArray(result.questions)) throw new Error("模型结果缺少 questions 数组");
  const discardedQuestionNumbers: string[] = [];
  const seenNumbers = new Set<string>();
  const questions = result.questions.flatMap((value, questionIndex): Question[] => {
    const item = objectValue(value);
    const number = String(item?.number ?? "").trim();
    if (!item || !isValidQuestionNumber(number) || seenNumbers.has(number)) {
      discardedQuestionNumbers.push(number || `item-${questionIndex + 1}`);
      return [];
    }
    seenNumbers.add(number);
    return [normalizeQuestionValue(item, input)];
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
