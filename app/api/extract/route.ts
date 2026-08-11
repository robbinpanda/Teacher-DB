import { and, eq, inArray } from "drizzle-orm";
import { getDb, getSqlite, sqliteTransaction } from "../../../db";
import { ensureDatabase } from "../../../db/bootstrap";
import { assets, documents, extractionRuns, pages, questions } from "../../../db/schema";
import { resolveModelProfile } from "../../../lib/model-profiles";
import { mergeContinuationText, mergeQuestionOptions } from "../../../lib/question-continuation";
import { now, requestOwner } from "../../../lib/server";
import type { BoundingBox, Question, QuestionType } from "../../../lib/types";
import { callVisionModel, ModelCallError } from "../../../lib/vision-model";
import { contentTypeForKey, getFile } from "../../../lib/file-storage";
import { resolveExtractionPage, selectPrimaryExtractionRegion } from "../../../lib/extraction-pages";
import { stageFromGrade } from "../../../lib/education-taxonomy";
import { getTagCatalog } from "../../../lib/tag-catalog";
import { modelNeedsHumanReview } from "../../../lib/model-review";
import { findMatchingAsset } from "../../../lib/extraction-assets";
import { loadContinuationCandidates } from "../../../lib/continuation-candidates";
import { assertDocumentLease, LostDocumentLeaseError } from "../../../lib/job-lease";
import { acceptsQuestionNumberSource, isValidQuestionNumber } from "../../../lib/question-number-source";
import { extractionCoverageFailures } from "../../../lib/extraction-coverage";
import { activateExtractionRun } from "../../../lib/extraction-run";

export const runtime = "nodejs";

const systemPrompt = [
  "你是中文中学试卷的视觉结构化专家。只能抄录图中确实可见的内容，禁止凭常识补写模糊、被遮挡或不在图中的文字。",
  "你会收到一张主页面，可能还会收到紧接着的下一页。为了双重校验，两页中所有清晰可见的印刷顶层题号都必须输出；系统会按题号幂等合并重复结果。无印刷题号的续页只允许关联提示中明确列出的跨页候选。",
  "1. 将题干、选项、答案、解析严格分开。保留原有编号和语义顺序；页面没有答案或解析时使用空字符串。",
  "2. 行内和独立数学表达式全部转为 LaTeX，并用单个 $ 包裹。不要把普通中文、题号或选项字母放进 LaTeX。",
  "3. regions 表示一道题在每个来源页上的实际可见印刷范围，按页码升序排列。跨页题必须给出本次可见的各页 regions；page 必须填写提示中的原卷真实页码（例如主页面为第9页时写9，绝不能按输入图片顺序写1）；每个 bbox 都相对于它自己的单页，使用 0-100 百分比坐标。系统会逐页合并同一题号，因此跨三页及以上时也必须沿用同一顶层题号。",
  "4. bbox 必须贴合内容：包含题号、完整题干、选项、作答横线及属于该题的图注；排除页眉、页脚、密封线、装订线、空白页边和相邻题目。边缘可留 0.3%-0.8% 安全余量，不要使用整页大框。",
  "5. assets 只框必须作为图片保存的几何图、函数图象、统计图、地图、实验装置或无法可靠转成文字的表格。asset bbox 紧贴图形本身，可包含图内标注，但不要包含外围题干或无关空白。纯文字、普通公式和可转写的小表格不要建 asset。",
  "5a. 一道题可以有多张题图。每个独立图形、图表或子图组分别输出一个 asset，按阅读顺序排列；不得把相距较远的多张图连同题干一起框成一个大图，也不得因为已经输出一张图而漏掉其余题图。",
  "6. type 只能是 single、multiple、fill、answer。不要提取或输出分值。tags 只能从用户提示给出的允许标签中选择 1-3 个，禁止创造近义标签或临时标签。confidence 要反映文字与框选两者中较低的可信度，但仅用于展示，绝不能用它决定是否需要人工核查。",
  "7. 如果主页面是答案或解析页，不要把答案条目伪造成新题；放进 answerUpdates，并按原题号关联，同时为答案或解析在本次实际可见的每一页输出 regions。跨页解析必须始终沿用同一题号，系统会逐页合并为完整 analysis。",
  "7a. 大题完整性优先：一道大题包含（1）（2）或【小问1详解】【小问2详解】等多个小问时，必须把所有小问的题干、答案和解析合并到同一个顶层题号。看到【小问1详解】绝不表示大题结束；必须继续向下并检查下一页，直到出现下一个独立顶层阿拉伯数字题号或本卷结束。",
  "7b. 主页面可能同时包含上一题的续页和下一题的开头。必须先找出页面上每个独立顶层题号的印刷位置，再按这些位置切分：页面顶部至下一个顶层题号之前属于已保存的跨页候选；新题 region 必须从它自己的顶层题号所在行开始。此时要同时输出前题续页和后题新题，两个 region 不得互换、重叠或错误覆盖页面顶部空白。",
  "7c. 新题的主页面 region 必须实际包住它自己的可见顶层题号；只有提示中列出的跨页候选允许在续页 region 内没有题号。长题干或长解析不得配一个角落小框。若文字量与框面积明显不相称，必须重新检查框边界后再输出。",
  "7d. 题号一致性是硬约束：有印刷顶层题号时逐字采用；页面没有印刷题号时，只能沿用提示中与该页连续的跨页候选题号，绝不能根据相似内容猜成更早的题号。若候选为第20题，后续无题号解析页必须始终写20，禁止改写为18或其他题号。",
  "7e. questions 和 answerUpdates 的每一项都必须输出 numberSource。只有该项 region 内清晰看见印刷的顶层题号时才写 printed；没有印刷题号、依靠跨页候选接力时必须写 continuation。continuation 的 number 必须逐字等于候选题号，系统会拒绝并重试任何不一致或缺失 numberSource 的结果。",
  "7f. 额外输出 pageAudit：为本轮提供的每一页逐页列出肉眼可见的全部独立顶层阿拉伯数字题号 visibleTopLevelNumbers。pageAudit 是独立复核，不得从 questions 复制后省略；每个可见题号必须同时出现在 questions 或 answerUpdates 中，否则系统会判定本轮漏题并自动重试。",
  "8. 输出前逐题自检：逐项核对题干中出现的每个（1）（2）等小问在 answer/analysis 中是否完整；逐页核对 region 从本题第一行到下一顶层题号前最后一行；region 四边应落在最外侧可见笔画之外，不能用版心或整栏边界代替内容边界；x+width、y+height 不得超过 100；相邻题目的 region 不得重叠；assets 必须完全位于同页对应题目的 region 内。",
  "8a. questions 和 answerUpdates 中都必须输出布尔字段 needsHumanReview。只要存在文字模糊、内容缺失、答案解析不完整、题型或框选存疑等任何问题，就输出 true；只有确认完整且无需再次人工核查时才输出 false。不确定时必须输出 true，禁止省略或输出字符串。",
  "主页面没有题号或题目开头、只有下一页 region 的候选题必须丢弃；严禁为了保留它而补造默认 bbox。",
  "number 只填写整道大题的阿拉伯数字题号；（1）、【小问1】、步骤讲解必须合并进所属大题，禁止单独创建为题目。",
  "9. 不要输出 Markdown、解释或代码围栏，只输出严格 JSON。",
  "JSON 格式：",
  "{\"documentMeta\":{\"subject\":\"数学\",\"grade\":\"九年级\",\"year\":2026,\"examType\":\"二模\",\"region\":\"上海市徐汇区\",\"school\":\"\"},\"pageAudit\":[{\"page\":1,\"visibleTopLevelNumbers\":[\"1\"]}],\"questions\":[{\"number\":\"1\",\"numberSource\":\"printed\",\"type\":\"single\",\"stem\":\"题干，公式如 $x^2$\",\"options\":[{\"key\":\"A\",\"content\":\"选项\"}],\"answer\":\"\",\"analysis\":\"\",\"regions\":[{\"page\":1,\"bbox\":{\"x\":8.2,\"y\":15.1,\"width\":84.0,\"height\":18.6}}],\"assets\":[{\"kind\":\"figure\",\"label\":\"几何图\",\"page\":1,\"bbox\":{\"x\":55.0,\"y\":20.0,\"width\":25.0,\"height\":12.0}}],\"tags\":[\"允许标签之一\"],\"confidence\":0.95,\"needsHumanReview\":false}],\"answerUpdates\":[{\"number\":\"1\",\"numberSource\":\"printed\",\"answer\":\"答案 LaTeX\",\"analysis\":\"解析\",\"confidence\":0.95,\"needsHumanReview\":false,\"regions\":[{\"page\":8,\"bbox\":{\"x\":8.2,\"y\":12.0,\"width\":84.0,\"height\":76.0}}]}]}",
].join("\n");

function safeBox(value: unknown): BoundingBox {
  const box = value as Partial<BoundingBox> | null;
  const x = Math.max(0, Math.min(99, Number(box?.x ?? 0)));
  const y = Math.max(0, Math.min(99, Number(box?.y ?? 0)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(100 - x, Number(box?.width ?? 10))),
    height: Math.max(1, Math.min(100 - y, Number(box?.height ?? 10))),
  };
}

function hasExplicitBox(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const box = value as Partial<BoundingBox>;
  return [box.x, box.y, box.width, box.height].every((part) => Number.isFinite(Number(part)))
    && Number(box.width) > 0 && Number(box.height) > 0;
}

type AnswerUpdate = {
  number: string;
  answer: string;
  analysis: string;
  confidence: number;
  needsHumanReview: boolean;
  regions: Array<{ page: number; bbox: BoundingBox }>;
};

function normalize(raw: unknown, pageNumber: number, availablePages: number[], allowedTags: string[], continuationNumbers: ReadonlySet<string>): { questions: Question[]; answerUpdates: AnswerUpdate[]; documentMeta: Record<string, unknown>; diagnostics: { acceptedQuestionNumbers: string[]; discardedQuestionNumbers: string[]; unmatchedAnswerUpdateNumbers: string[]; rejectedNumberAssociations: string[]; visibleTopLevelNumbers: string[]; uncoveredVisibleNumbers: string[]; missingPageAuditPages: number[] } } {
  const result = raw as { questions?: unknown[]; answerUpdates?: unknown[]; pageAudit?: unknown[]; documentMeta?: Record<string, unknown> };
  const allowed = new Set(allowedTags);
  const items = Array.isArray(result?.questions) ? result.questions : [];
  const rawUpdates = Array.isArray(result?.answerUpdates) ? result.answerUpdates : [];
  if (!Array.isArray(result?.questions) && !Array.isArray(result?.answerUpdates)) {
    throw new Error("模型结果缺少 questions 和 answerUpdates 数组");
  }
  const rejectedNumberAssociations: string[] = [];
  const normalizedQuestions = items.map((value, index): Question | null => {
    const item = value as Record<string, unknown>;
    const questionNumber = String(item.number ?? "").trim();
    if (!isValidQuestionNumber(questionNumber)) {
      rejectedNumberAssociations.push(`question:${questionNumber || `item-${index + 1}`}:invalid-number`);
      return null;
    }
    if (!acceptsQuestionNumberSource(questionNumber, item.numberSource, continuationNumbers)) {
      rejectedNumberAssociations.push(`question:${questionNumber}:${String(item.numberSource ?? "missing")}`);
      return null;
    }
    const type = ["single", "multiple", "fill", "answer"].includes(String(item.type)) ? String(item.type) as QuestionType : "answer";
    const id = crypto.randomUUID();
    const rawRegions = Array.isArray(item.regions) ? item.regions : [];
    const regions = rawRegions.filter((region) => hasExplicitBox((region as Record<string, unknown>).bbox)).map((region) => {
      const entry = region as Record<string, unknown>;
      return { page: resolveExtractionPage(entry.page, availablePages, pageNumber), bbox: safeBox(entry.bbox) };
    }).filter((region) => availablePages.includes(region.page));
    // 模型偶尔会提前读出随附的下一页。只要框选落在本轮真实提供的页面内就保留，
    // 后续处理该页时会按题号合并，避免“原始 JSON 已识别、最终题库却缺题”。
    if (!regions.length) return null;
    const uniqueRegions = regions.filter((region, regionIndex) => regions.findIndex((candidate) => candidate.page === region.page) === regionIndex);
    const primaryRegion = selectPrimaryExtractionRegion(uniqueRegions, pageNumber);
    const rawAssets = Array.isArray(item.assets) ? item.assets : [];
    const normalizedAssets = rawAssets.map((asset, assetIndex) => {
      const entry = asset as Record<string, unknown>;
      return {
        id: id + "-asset-" + assetIndex,
        kind: ["figure", "table", "graph"].includes(String(entry.kind)) ? String(entry.kind) as "figure" | "table" | "graph" : "figure",
        label: String(entry.label ?? "题图"),
        page: resolveExtractionPage(entry.page, availablePages, pageNumber),
        bbox: safeBox(entry.bbox),
      };
    }).filter((asset) => availablePages.includes(asset.page));
    const confidence = Math.max(0, Math.min(1, Number(item.confidence ?? 0)));
    const stem = String(item.stem ?? "");
    const options = Array.isArray(item.options) ? item.options.map((option) => {
      const entry = option as Record<string, unknown>;
      return { key: String(entry.key ?? ""), content: String(entry.content ?? "") };
    }) : undefined;
    const answer = String(item.answer ?? "");
    const analysis = String(item.analysis ?? "");
    const needsHumanReview = modelNeedsHumanReview(item.needsHumanReview);
    return {
      id,
      number: questionNumber,
      type,
      stem,
      options,
      answer,
      analysis,
      page: primaryRegion.page,
      bbox: primaryRegion.bbox,
      regions: uniqueRegions,
      assets: normalizedAssets,
      tags: Array.isArray(item.tags) ? Array.from(new Set(item.tags.map(String).filter((tag) => allowed.has(tag)))).slice(0, 3) : [],
      confidence,
      needsHumanReview,
      status: needsHumanReview ? "needs_attention" : "pending",
    };
  }).filter((question): question is Question => question !== null);
  const answerUpdates = rawUpdates.map((value) => {
    const item = value as Record<string, unknown>;
    const number = String(item.number ?? "").trim();
    if (!isValidQuestionNumber(number)) {
      rejectedNumberAssociations.push(`answerUpdate:${number || "missing"}:invalid-number`);
      return null;
    }
    if (!acceptsQuestionNumberSource(number, item.numberSource, continuationNumbers)) {
      rejectedNumberAssociations.push(`answerUpdate:${number}:${String(item.numberSource ?? "missing")}`);
      return null;
    }
    const regions = (Array.isArray(item.regions) ? item.regions : [])
      .filter((region) => hasExplicitBox((region as Record<string, unknown>).bbox)).map((region) => {
      const entry = region as Record<string, unknown>;
      return { page: resolveExtractionPage(entry.page, availablePages, pageNumber), bbox: safeBox(entry.bbox) };
    }).filter((region) => availablePages.includes(region.page))
      .filter((region, index, all) => all.findIndex((candidate) => candidate.page === region.page) === index);
    return {
      number,
      answer: String(item.answer ?? ""),
      analysis: String(item.analysis ?? ""),
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
      needsHumanReview: modelNeedsHumanReview(item.needsHumanReview),
      regions,
    };
  }).filter((item): item is AnswerUpdate => item !== null && isValidQuestionNumber(item.number) && Boolean(item.answer || item.analysis));
  const acceptedQuestionNumbers = normalizedQuestions.map((question) => question.number);
  const accepted = new Set(acceptedQuestionNumbers);
  const discardedQuestionNumbers = items.map((value) => String((value as Record<string, unknown>).number ?? "").trim())
    .filter((number) => isValidQuestionNumber(number) && !accepted.has(number));
  const auditedPages = new Set<number>();
  const visibleTopLevelNumbers = (Array.isArray(result.pageAudit) ? result.pageAudit : []).flatMap((value) => {
    const audit = value as Record<string, unknown>;
    const auditPage = resolveExtractionPage(audit.page, availablePages, pageNumber);
    if (!availablePages.includes(auditPage) || !Array.isArray(audit.visibleTopLevelNumbers)) return [];
    auditedPages.add(auditPage);
    return audit.visibleTopLevelNumbers.map((number) => String(number).trim()).filter(isValidQuestionNumber);
  });
  const missingPageAuditPages = availablePages.filter((availablePage) => !auditedPages.has(availablePage));
  const returnedNumbers = new Set([...acceptedQuestionNumbers, ...answerUpdates.map((update) => update.number)]);
  const uncoveredVisibleNumbers = Array.from(new Set(visibleTopLevelNumbers.filter((number) => !returnedNumbers.has(number))));
  return {
    questions: normalizedQuestions,
    answerUpdates,
    documentMeta: result.documentMeta ?? {},
    diagnostics: {
      acceptedQuestionNumbers,
      discardedQuestionNumbers,
      unmatchedAnswerUpdateNumbers: [],
      rejectedNumberAssociations,
      visibleTopLevelNumbers: Array.from(new Set(visibleTopLevelNumbers)),
      uncoveredVisibleNumbers,
      missingPageAuditPages,
    },
  };
}

function parseJsonContent(content: string) {
  let clean = content.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (clean.startsWith(fence)) clean = clean.slice(clean.indexOf("\n") + 1);
  if (clean.endsWith(fence)) clean = clean.slice(0, -3).trim();
  try {
    return JSON.parse(clean);
  } catch (firstError) {
    // 部分兼容网关不提供 JSON schema 模式，模型会把 LaTeX 的单反斜杠直接放进 JSON。
    // 只修复未转义且不是引号/反斜杠转义的字符，再交回标准 JSON.parse 严格校验。
    const repaired = clean.replace(/(?<!\\)\\(?!["\\])/g, "\\\\");
    if (repaired === clean) throw firstError;
    return JSON.parse(repaired);
  }
}

export async function POST(request: Request) {
  const payload = await request.json() as {
    documentId?: string; pageId?: string; pageNumber?: number; image?: string; fileName?: string;
    profileId?: string; workerId?: string;
  };
  if (!payload.documentId) return Response.json({ error: "documentId 为必填项" }, { status: 400 });
  const documentId = payload.documentId;
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const pageNumber = Number(payload.pageNumber ?? 1);
  const db = getDb();
  const ownedDocument = await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)),
  });
  if (!ownedDocument) return Response.json({ error: "文档不存在" }, { status: 404 });
  const tagCatalog = await getTagCatalog(ownerId, ownedDocument.subject || "数学", stageFromGrade(ownedDocument.grade));
  const allowedTags = tagCatalog.map((item) => item.name);
  const ownedPage = payload.pageId
    ? await db.query.pages.findFirst({ where: and(eq(pages.id, payload.pageId), eq(pages.documentId, documentId)) })
    : await db.query.pages.findFirst({ where: and(eq(pages.documentId, documentId), eq(pages.pageNumber, pageNumber)) });
  if (!ownedPage || ownedPage.pageNumber !== pageNumber) return Response.json({ error: "页面与文档不匹配" }, { status: 400 });
  const nextPage = await db.query.pages.findFirst({
    where: and(eq(pages.documentId, documentId), eq(pages.pageNumber, pageNumber + 1)),
  });
  const sourcePages = [ownedPage, ...(nextPage ? [nextPage] : [])];
  const continuationCandidates = loadContinuationCandidates(getSqlite(), documentId, pageNumber);
  const modelImages: Array<{ page: number; dataUrl: string }> = [];
  for (const sourcePage of sourcePages) {
    let dataUrl = sourcePage.id === ownedPage.id ? payload.image : undefined;
    if (!dataUrl) {
      const bytes = await getFile(sourcePage.storageKey);
      if (bytes.byteLength > 20 * 1024 * 1024) return Response.json({ error: `第 ${sourcePage.pageNumber} 页落盘图超过 20 MB` }, { status: 413 });
      dataUrl = `data:${contentTypeForKey(sourcePage.storageKey)};base64,${bytes.toString("base64")}`;
    }
    if (!dataUrl.startsWith("data:image/") || dataUrl.length > 30 * 1024 * 1024) {
      return Response.json({ error: `第 ${sourcePage.pageNumber} 页图像格式非法或超过 30 MB` }, { status: 413 });
    }
    modelImages.push({ page: sourcePage.pageNumber, dataUrl });
  }
  const sqlite = getSqlite();
  const activeJob = sqlite.prepare(
    "SELECT status FROM document_jobs WHERE document_id = ?",
  ).get(documentId) as { status: string } | undefined;
  if (activeJob?.status === "processing" && !payload.workerId) {
    return Response.json({ error: "识别任务正在由队列处理，拒绝无租约的并发写入", code: "worker_required" }, { status: 409 });
  }
  if (payload.workerId) {
    try { assertDocumentLease(sqlite, documentId, payload.workerId, now()); }
    catch (error) {
      if (error instanceof LostDocumentLeaseError) {
        return Response.json({ error: error.message, code: error.code, retryable: false }, { status: 409 });
      }
      throw error;
    }
  }
  const proposedRunId = crypto.randomUUID();
  const createdAt = now();
  const idempotencyKey = `${documentId}:page:${pageNumber}:extract-v3`;
  const existingRun = await getDb().query.extractionRuns.findFirst({
    where: and(eq(extractionRuns.idempotencyKey, idempotencyKey), eq(extractionRuns.status, "complete")),
  });
  if (existingRun) {
    const existingQuestions = await loadPageQuestions(documentId, pageNumber);
    return Response.json({
      runId: existingRun.id, provider: existingRun.provider, model: existingRun.model,
      mode: "live", idempotentReplay: true, questions: existingQuestions,
    });
  }

  let profile;
  try {
    profile = await resolveModelProfile(ownerId, payload.profileId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型配置不可用" }, { status: 400 });
  }

  const activeRun = activateExtractionRun(sqlite, {
    proposedRunId,
    documentId,
    pageId: ownedPage.id,
    pageNumber,
    profileId: profile.id,
    provider: profile.provider,
    model: profile.model,
    idempotencyKey,
    timestamp: createdAt,
  });
  const runId = activeRun.id;

  try {
    const continuationContext = continuationCandidates.length > 0
      ? `已保存的跨页接力候选如下：${JSON.stringify(continuationCandidates)}。如果主页面顶部在出现新顶层题号之前仍是某候选的内容，必须先沿用其 number 输出这段续页，不能把它框给页面下方的新题。题干或选项的继续放入 questions；答案或解析的继续放入 answerUpdates。只输出本次新看到、尚未保存的文字，并为本次实际可见的每一页输出 regions。若内容并非候选的继续，不要输出该候选。`
      : "当前没有已保存的跨页接力候选。";
    const result = await callVisionModel({
      ownerId,
      profileId: profile.id,
      purpose: "page_extraction",
      documentId,
      pageNumber,
      system: `${systemPrompt}\n允许标签（只能逐字选择）：${JSON.stringify(allowedTags)}`,
      text: `文件：${payload.fileName ?? "未命名试卷"}。主页面是第 ${pageNumber} 页${nextPage ? `，并附带第 ${nextPage.pageNumber} 页用于交叉复核和补全跨页题` : "，这是最后一页"}。${pageNumber === 1 ? "请从卷面标题和卷头推测 documentMeta；看不清的字段使用空字符串，年份无法确认时使用 null。" : "documentMeta 使用空对象。"}两页中所有带清晰印刷顶层题号的新题都必须输出，重复题系统会幂等合并；已保存候选可以在确认连续时接力。${continuationContext} 本轮必须先做版面切分：逐页定位所有独立顶层题号并写入 pageAudit；检查页面顶部是否为前题续页；检查每道含（1）（2）等小问的大题是否一直读取到全部小问解析结束。若页面上方是前题续页、下方才出现新题号，必须分别给前题上半页 region 和新题下半页 region，新题框从其印刷题号行开始。页面原始尺寸：${sourcePages.map((page) => `第${page.pageNumber}页 ${page.width}×${page.height}`).join("；")}。`,
      images: modelImages,
      jsonMode: true,
    });
    const parsedContent = parseJsonContent(result.content);
    const normalized = normalize(
      parsedContent,
      pageNumber,
      sourcePages.map((page) => page.pageNumber),
      allowedTags,
      new Set(continuationCandidates.map((candidate) => candidate.number)),
    );
    const validationFailures = extractionCoverageFailures(normalized.diagnostics);
    if (validationFailures.length) {
      throw new Error(`题号与覆盖校验失败：${validationFailures.join("、")}`);
    }
    const extracted = normalized.questions;
    const finishedAt = now();
    sqliteTransaction((transaction) => {
      if (payload.workerId) assertDocumentLease(transaction, documentId, payload.workerId, finishedAt);
      for (const question of extracted) {
        const existingQuestion = transaction.prepare(
          `SELECT id, stem, options_json AS optionsJson, answer, analysis, status,
                  needs_human_review AS needsHumanReview, confidence
             FROM questions WHERE document_id = ? AND number = ? LIMIT 1`,
        ).get(documentId, question.number) as {
          id: string;
          stem: string;
          optionsJson: string | null;
          answer: string;
          analysis: string;
          status: Question["status"];
          needsHumanReview: number | null;
          confidence: number;
        } | undefined;
        const questionId = existingQuestion?.id ?? question.id;
        if (existingQuestion) {
          const mergedStem = mergeContinuationText(existingQuestion.stem, question.stem);
          const mergedOptions = mergeQuestionOptions(existingQuestion.optionsJson, question.options);
          const mergedAnswer = mergeContinuationText(existingQuestion.answer, question.answer);
          const mergedAnalysis = mergeContinuationText(existingQuestion.analysis, question.analysis);
          const mergedConfidence = existingQuestion.confidence > 0
            ? Math.min(existingQuestion.confidence, question.confidence)
            : question.confidence;
          const mergedNeedsHumanReview = existingQuestion.needsHumanReview !== 0 || question.needsHumanReview;
          const mergedStatus = existingQuestion.status === "approved"
            ? "approved"
            : mergedNeedsHumanReview ? "needs_attention" : "pending";
          transaction.prepare(
            `UPDATE questions SET
               stem = ?, options_json = ?, answer = ?, analysis = ?, status = ?, needs_human_review = ?,
               confidence = ?, score = 0, updated_at = ?
             WHERE id = ?`,
          ).run(
            mergedStem, JSON.stringify(mergedOptions), mergedAnswer, mergedAnalysis, mergedStatus, mergedNeedsHumanReview ? 1 : 0,
            mergedConfidence, createdAt, questionId,
          );
          question.id = questionId;
          question.stem = mergedStem;
          question.options = mergedOptions;
          question.answer = mergedAnswer;
          question.analysis = mergedAnalysis;
          question.status = mergedStatus;
          question.needsHumanReview = mergedNeedsHumanReview;
          question.confidence = mergedConfidence;
        } else {
          transaction.prepare(
            `INSERT INTO questions
              (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json, status, needs_human_review, confidence, score, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            questionId, documentId, question.number, question.type, question.stem,
            JSON.stringify(question.options ?? []), question.answer, question.analysis, question.page,
            JSON.stringify(question.bbox), question.status, question.needsHumanReview ? 1 : 0, question.confidence, 0, createdAt, createdAt,
          );
        }
        for (const [regionIndex, region] of question.regions.entries()) {
          const regionPage = sourcePages.find((page) => page.pageNumber === region.page);
          transaction.prepare(
            `INSERT INTO question_regions (id, question_id, page_id, page_number, bbox_json, position, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(question_id, page_number) DO UPDATE SET
               page_id = excluded.page_id, bbox_json = excluded.bbox_json, position = excluded.position`,
          ).run(crypto.randomUUID(), questionId, regionPage?.id ?? null, region.page, JSON.stringify(region.bbox), regionIndex, createdAt);
        }
        const existingAssets = transaction.prepare(
          "SELECT id, page_id AS pageId, bbox_json AS bboxJson FROM question_assets WHERE question_id = ?",
        ).all(questionId) as Array<{ id: string; pageId: string | null; bboxJson: string }>;
        for (const [assetPosition, asset] of question.assets.entries()) {
          const assetPage = sourcePages.find((page) => page.pageNumber === asset.page);
          const matchingAsset = findMatchingAsset(existingAssets.map((candidate) => ({
            id: candidate.id,
            pageId: candidate.pageId,
            bbox: JSON.parse(candidate.bboxJson) as BoundingBox,
          })), assetPage?.id ?? null, asset.bbox);
          if (matchingAsset) asset.id = matchingAsset.id;
          transaction.prepare(
            `INSERT INTO question_assets (id, question_id, page_id, kind, label, source_key, bbox_json, position, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET page_id = excluded.page_id, kind = excluded.kind,
               label = excluded.label, bbox_json = excluded.bbox_json, position = excluded.position`,
          ).run(asset.id, questionId, assetPage?.id ?? null, asset.kind, asset.label, null, JSON.stringify(asset.bbox), assetPosition, createdAt);
          if (!matchingAsset) existingAssets.push({ id: asset.id, pageId: assetPage?.id ?? null, bboxJson: JSON.stringify(asset.bbox) });
        }
        for (const tagName of question.tags) {
          transaction.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(crypto.randomUUID(), tagName, createdAt);
          transaction.prepare(
            "INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
          ).run(questionId, tagName);
        }
        transaction.prepare("UPDATE question_regions SET position = page_number WHERE question_id = ?").run(questionId);
      }
      for (const update of normalized.answerUpdates) {
        const target = transaction.prepare(
          "SELECT id, stem, answer, analysis, needs_human_review AS needsHumanReview, confidence, status FROM questions WHERE document_id = ? AND number = ? LIMIT 1",
        ).get(documentId, update.number) as {
          id: string;
          stem: string;
          answer: string;
          analysis: string;
          confidence: number;
          needsHumanReview: number | null;
          status: Question["status"];
        } | undefined;
        if (!target) {
          normalized.diagnostics.unmatchedAnswerUpdateNumbers.push(update.number);
          continue;
        }
        const mergedAnswer = mergeContinuationText(target.answer, update.answer);
        const mergedAnalysis = mergeContinuationText(target.analysis, update.analysis);
        const mergedConfidence = target.confidence > 0
          ? Math.min(target.confidence, update.confidence)
          : update.confidence;
        const mergedNeedsHumanReview = target.needsHumanReview !== 0 || update.needsHumanReview;
        const mergedStatus = target.status === "approved"
          ? "approved"
          : mergedNeedsHumanReview ? "needs_attention" : "pending";
        transaction.prepare(
          `UPDATE questions SET answer = ?, analysis = ?, needs_human_review = ?, confidence = ?, status = ?, updated_at = ? WHERE id = ?`,
        ).run(mergedAnswer, mergedAnalysis, mergedNeedsHumanReview ? 1 : 0, mergedConfidence, mergedStatus, finishedAt, target.id);
        for (const [regionIndex, region] of update.regions.entries()) {
          const regionPage = sourcePages.find((page) => page.pageNumber === region.page);
          transaction.prepare(
            `INSERT INTO question_regions (id, question_id, page_id, page_number, bbox_json, position, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(question_id, page_number) DO UPDATE SET
               page_id = excluded.page_id, bbox_json = excluded.bbox_json, position = excluded.position`,
          ).run(crypto.randomUUID(), target.id, regionPage?.id ?? null, region.page, JSON.stringify(region.bbox), regionIndex, createdAt);
        }
        transaction.prepare("UPDATE question_regions SET position = page_number WHERE question_id = ?").run(target.id);
      }
      transaction.prepare(
        `UPDATE extraction_runs SET status = 'complete', raw_json = ?, error = NULL, error_code = NULL,
           next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?
         WHERE idempotency_key = ?`,
      ).run(JSON.stringify({ ...(parsedContent as Record<string, unknown>), _pipeline: normalized.diagnostics }), finishedAt, idempotencyKey);
      transaction.prepare(
        "UPDATE documents SET status = 'extracting', error = NULL, updated_at = ? WHERE id = ?",
      ).run(finishedAt, documentId);
      if (pageNumber === 1) {
        const meta = normalized.documentMeta;
        const inferredYear = Number(meta.year);
        transaction.prepare(
          `UPDATE documents SET
             source_year = CASE WHEN source_year IS NULL AND ? BETWEEN 1900 AND 2200 THEN ? ELSE source_year END,
             source_exam_type = CASE WHEN COALESCE(source_exam_type, '') = '' THEN NULLIF(?, '') ELSE source_exam_type END,
             source_region = CASE WHEN COALESCE(source_region, '') = '' THEN NULLIF(?, '') ELSE source_region END,
             source_school = CASE WHEN COALESCE(source_school, '') = '' THEN NULLIF(?, '') ELSE source_school END
           WHERE id = ?`,
        ).run(inferredYear, inferredYear, String(meta.examType ?? "").slice(0, 80), String(meta.region ?? "").slice(0, 80), String(meta.school ?? "").slice(0, 120), documentId);
      }
    });
    return Response.json({
      runId, provider: profile.provider, model: profile.model, modelProfileId: profile.id,
      mode: "live", idempotentReplay: false, questions: extracted, answerUpdates: normalized.answerUpdates,
    });
  } catch (error) {
    if (error instanceof LostDocumentLeaseError) {
      return Response.json({ error: error.message, code: error.code, retryable: false, runId }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "识别失败";
    const finishedAt = now();
    if (!payload.workerId) {
      sqliteTransaction((transaction) => {
        transaction.prepare(
          "UPDATE extraction_runs SET status = 'failed', error = ?, finished_at = ? WHERE idempotency_key = ?",
        ).run(message.slice(0, 4000), finishedAt, idempotencyKey);
        transaction.prepare("UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
          .run(message.slice(0, 4000), finishedAt, documentId);
      });
    }
    return Response.json({
      error: message,
      runId,
      code: error instanceof ModelCallError ? error.code : "extraction_error",
      retryable: error instanceof ModelCallError ? error.retryable : true,
      retryAfterMs: error instanceof ModelCallError ? error.retryAfterMs : undefined,
    }, { status: 502 });
  }
}

async function loadPageQuestions(documentId: string, pageNumber: number): Promise<Question[]> {
  const db = getDb();
  const rows = await db.select().from(questions).where(and(eq(questions.documentId, documentId), eq(questions.pageNumber, pageNumber)));
  const ids = rows.map((row) => row.id);
  const assetRows = ids.length ? await db.select().from(assets).where(inArray(assets.questionId, ids)) : [];
  const regionRows = ids.length
    ? getSqlite().prepare(
        `SELECT question_id AS questionId, page_number AS page, bbox_json AS bboxJson
           FROM question_regions WHERE question_id IN (${ids.map(() => "?").join(",")}) ORDER BY position`,
      ).all(...ids) as Array<{ questionId: string; page: number; bboxJson: string }>
    : [];
  const tagRows = ids.length
    ? getSqlite().prepare(
        `SELECT qt.question_id AS questionId, t.name AS name FROM question_tags qt JOIN tags t ON t.id = qt.tag_id
         WHERE qt.question_id IN (${ids.map(() => "?").join(",")})`,
      ).all(...ids) as Array<{ questionId: string; name: string }>
    : [] as Array<{ questionId: string; name: string }>;
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    type: row.type as QuestionType,
    stem: row.stem,
    options: JSON.parse(row.optionsJson ?? "[]") as Question["options"],
    answer: row.answer,
    analysis: row.analysis,
    page: row.pageNumber,
    bbox: JSON.parse(row.bboxJson) as BoundingBox,
    regions: regionRows.filter((region) => region.questionId === row.id).map((region) => ({
      page: region.page,
      bbox: JSON.parse(region.bboxJson) as BoundingBox,
    })).concat(regionRows.some((region) => region.questionId === row.id) ? [] : [{ page: row.pageNumber, bbox: JSON.parse(row.bboxJson) as BoundingBox }]),
    assets: assetRows.filter((asset) => asset.questionId === row.id).sort((left, right) => left.position - right.position).map((asset) => ({
      id: asset.id,
      kind: asset.kind as "figure" | "table" | "graph",
      page: assetRows.find((candidate) => candidate.id === asset.id)?.pageId
        ? (getSqlite().prepare("SELECT page_number AS page FROM pages WHERE id = ?").get(asset.pageId) as { page: number } | undefined)?.page ?? row.pageNumber
        : row.pageNumber,
      bbox: JSON.parse(asset.bboxJson) as BoundingBox,
      label: asset.label,
    })),
    tags: tagRows.filter((tag) => tag.questionId === row.id).map((tag) => tag.name),
    confidence: row.confidence,
    needsHumanReview: row.needsHumanReview !== false,
    status: row.status === "approved" ? "approved" : row.needsHumanReview !== false ? "needs_attention" : "pending",
  }));
}
