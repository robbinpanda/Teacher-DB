import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { QuestionType, VariationReview } from "./types";

export const QUESTION_PACKAGE_MIME = "application/vnd.jianti.question-bank+gzip";
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
export const MAX_PACKAGE_ASSETS = 1000;

export type SharedQuestionAsset = {
  kind: "figure" | "table" | "graph";
  role: "question" | "answer";
  label: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  sha256: string;
};

export type SharedQuestion = {
  externalId: string;
  parentExternalId: string | null;
  variationKind: string | null;
  variationReview: VariationReview | null;
  folderPath: string[];
  number: string;
  type: QuestionType;
  stem: string;
  options: Array<{ key: string; content: string }>;
  answer: string;
  analysis: string;
  tags: string[];
  source: {
    documentKey: string;
    documentName: string;
    subject: string;
    grade: string;
    year: number | null;
    examType: string | null;
    region: string | null;
    textbook: string | null;
    school: string | null;
  };
  assets: SharedQuestionAsset[];
};

export type QuestionPackage = {
  format: "jianti-question-bank";
  schemaVersion: 1;
  packageId: string;
  title: string;
  exportedAt: string;
  questionCount: number;
  questions: SharedQuestion[];
};

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function text(value: unknown, field: string, max: number, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > max || /\u0000/.test(result)) throw new Error(`${field} 无效`);
  return result;
}

function nullableText(value: unknown, field: string, max: number) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, field, max, true);
}

function nullableYear(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error("来源年份无效");
  return year;
}

function hasExpectedImageSignature(bytes: Buffer, mimeType: SharedQuestionAsset["mimeType"]) {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function validateAsset(value: unknown, index: number): SharedQuestionAsset {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item) throw new Error(`第 ${index + 1} 张图片结构无效`);
  const kind = String(item.kind);
  const role = String(item.role);
  const mimeType = String(item.mimeType);
  if (!["figure", "table", "graph"].includes(kind) || !["question", "answer"].includes(role)) throw new Error("图片类型无效");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("共享包包含不支持的图片格式");
  const data = text(item.data, "图片数据", 12 * 1024 * 1024, true);
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("图片 Base64 数据无效");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.byteLength > 8 * 1024 * 1024 || bytes.toString("base64") !== data) {
    throw new Error("图片 Base64 数据无效或图片超过 8 MB");
  }
  const typedMime = mimeType as SharedQuestionAsset["mimeType"];
  if (!hasExpectedImageSignature(bytes, typedMime)) throw new Error("共享包图片内容与声明格式不一致");
  const digest = text(item.sha256, "图片校验值", 64, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest) || sha256(bytes) !== digest) throw new Error("共享包图片校验失败，文件可能已损坏");
  return {
    kind: kind as SharedQuestionAsset["kind"],
    role: role as SharedQuestionAsset["role"],
    mimeType: typedMime,
    label: text(item.label, "图片名称", 80) || "题图",
    data,
    sha256: digest,
  };
}

function validateQuestion(value: unknown, index: number): SharedQuestion {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item) throw new Error(`第 ${index + 1} 道题结构无效`);
  const source = item.source && typeof item.source === "object" ? item.source as Record<string, unknown> : null;
  if (!source) throw new Error(`第 ${index + 1} 道题缺少来源信息`);
  const type = String(item.type);
  if (!["single", "multiple", "fill", "answer"].includes(type)) throw new Error(`第 ${index + 1} 道题题型无效`);
  if (Array.isArray(item.options) && item.options.length > 8) throw new Error(`第 ${index + 1} 道题选项过多`);
  const options = Array.isArray(item.options) ? item.options.map((option) => {
    const row = option && typeof option === "object" ? option as Record<string, unknown> : null;
    if (!row) throw new Error("选项结构无效");
    return { key: text(row.key, "选项序号", 4, true), content: text(row.content, "选项内容", 2000, true) };
  }) : [];
  if (new Set(options.map((option) => option.key.toLocaleUpperCase())).size !== options.length) throw new Error("题目包含重复选项序号");
  if (Array.isArray(item.tags) && item.tags.length > 20) throw new Error(`第 ${index + 1} 道题标签过多`);
  const tags = Array.isArray(item.tags)
    ? Array.from(new Set(item.tags.map((tag) => text(tag, "标签", 32, true))))
    : [];
  if (Array.isArray(item.folderPath) && item.folderPath.length > 8) throw new Error(`第 ${index + 1} 道题文件夹层级超过 8 层`);
  const folder = Array.isArray(item.folderPath)
    ? item.folderPath.map((part) => text(part, "文件夹名称", 80, true))
    : [];
  if (Array.isArray(item.assets) && item.assets.length > 20) throw new Error(`第 ${index + 1} 道题图片过多`);
  const assets = Array.isArray(item.assets) ? item.assets.map(validateAsset) : [];
  const rawReview = item.variationReview && typeof item.variationReview === "object"
    ? item.variationReview as Record<string, unknown>
    : null;
  let variationReview: VariationReview | null = null;
  if (rawReview) {
    const mode = String(rawReview.mode);
    const reviewStatus = String(rawReview.status);
    const reviewScore = rawReview.score === null || rawReview.score === undefined ? null : Number(rawReview.score);
    if (!new Set(["rules", "multi_agent"]).has(mode)
      || !new Set(["rules_passed", "passed", "revised"]).has(reviewStatus)
      || (reviewScore !== null && (!Number.isInteger(reviewScore) || reviewScore < 0 || reviewScore > 100))
      || !Array.isArray(rawReview.issues) || rawReview.issues.length > 5) {
      throw new Error(`第 ${index + 1} 道题的变式审校记录无效`);
    }
    variationReview = {
      mode: mode as VariationReview["mode"],
      status: reviewStatus as VariationReview["status"],
      score: reviewScore,
      issues: rawReview.issues.map((issue) => text(issue, "审校问题", 160, true)),
      reviewer: nullableText(rawReview.reviewer, "审校模型", 100),
    };
  }
  return {
    externalId: text(item.externalId, "题目标识", 100, true),
    parentExternalId: nullableText(item.parentExternalId, "原题标识", 100),
    variationKind: nullableText(item.variationKind, "变式类型", 400),
    variationReview,
    folderPath: folder,
    number: text(item.number, "题号", 40, true),
    type: type as QuestionType,
    stem: text(item.stem, "题干", 12000, true),
    options,
    answer: text(item.answer, "答案", 6000),
    analysis: text(item.analysis, "解析", 12000),
    tags,
    source: {
      documentKey: text(source.documentKey, "来源标识", 100, true),
      documentName: text(source.documentName, "来源名称", 180, true),
      subject: text(source.subject, "学科", 32, true),
      grade: text(source.grade, "年级", 32, true),
      year: nullableYear(source.year),
      examType: nullableText(source.examType, "考试类型", 80),
      region: nullableText(source.region, "地区", 80),
      textbook: nullableText(source.textbook, "教材版本", 80),
      school: nullableText(source.school, "学校", 120),
    },
    assets,
  };
}

function validateQuestionRelationships(questions: SharedQuestion[]) {
  const byId = new Map(questions.map((question) => [question.externalId, question]));
  const sourceSnapshots = new Map<string, string>();
  const numbersBySource = new Map<string, Set<string>>();
  for (const question of questions) {
    const sourceSnapshot = JSON.stringify(question.source);
    const previousSource = sourceSnapshots.get(question.source.documentKey);
    if (previousSource && previousSource !== sourceSnapshot) {
      throw new Error(`来源标识 ${question.source.documentKey} 对应了互相冲突的试卷信息`);
    }
    sourceSnapshots.set(question.source.documentKey, sourceSnapshot);
    const numbers = numbersBySource.get(question.source.documentKey) ?? new Set<string>();
    if (numbers.has(question.number)) {
      throw new Error(`来源《${question.source.documentName}》包含重复题号 ${question.number}`);
    }
    numbers.add(question.number);
    numbersBySource.set(question.source.documentKey, numbers);

    if (!question.parentExternalId) continue;
    if (question.parentExternalId === question.externalId) throw new Error("题目不能把自身声明为原题");
  }

  for (const question of questions) {
    const path = new Set<string>();
    let current: SharedQuestion | undefined = question;
    while (current?.parentExternalId) {
      if (path.has(current.externalId)) throw new Error("共享包中的原题关系形成了循环");
      path.add(current.externalId);
      current = byId.get(current.parentExternalId);
    }
  }
}

export function readQuestionPackage(bytes: Uint8Array) {
  if (!bytes.length || bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error("共享包必须小于 50 MB");
  let unpacked: Buffer;
  try {
    unpacked = gunzipSync(bytes, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    throw new Error("无法解压共享包，请确认文件由拣题导出且未损坏");
  }
  let raw: unknown;
  try { raw = JSON.parse(unpacked.toString("utf8")) as unknown; }
  catch { throw new Error("共享包内容不是有效 JSON"); }
  const root = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!root || root.format !== "jianti-question-bank" || root.schemaVersion !== 1) throw new Error("不支持的共享包格式或版本");
  if (!Array.isArray(root.questions) || !root.questions.length || root.questions.length > 1000) {
    throw new Error("共享包题目数量需为 1-1000 道");
  }
  let declaredAssetCount = 0;
  for (const rawQuestion of root.questions) {
    const raw = rawQuestion && typeof rawQuestion === "object" ? rawQuestion as Record<string, unknown> : null;
    if (Array.isArray(raw?.assets)) declaredAssetCount += raw.assets.length;
    if (declaredAssetCount > MAX_PACKAGE_ASSETS) throw new Error(`共享包图片数量超过 ${MAX_PACKAGE_ASSETS} 张`);
  }
  const questions = root.questions.map(validateQuestion);
  if (Number(root.questionCount) !== questions.length) throw new Error("共享包题目计数校验失败");
  const uniqueIds = new Set(questions.map((question) => question.externalId));
  if (uniqueIds.size !== questions.length) throw new Error("共享包存在重复题目标识");
  validateQuestionRelationships(questions);
  let totalAssetBytes = 0;
  let totalAssetCount = 0;
  for (const question of questions) for (const asset of question.assets) {
    totalAssetCount += 1;
    totalAssetBytes += Buffer.from(asset.data, "base64").byteLength;
  }
  if (totalAssetCount > MAX_PACKAGE_ASSETS) throw new Error(`共享包图片数量超过 ${MAX_PACKAGE_ASSETS} 张`);
  if (totalAssetBytes > 80 * 1024 * 1024) throw new Error("共享包图片总量超过 80 MB");
  return {
    format: "jianti-question-bank",
    schemaVersion: 1,
    packageId: text(root.packageId, "共享包标识", 100, true),
    title: text(root.title, "共享包名称", 80) || "共享题库",
    exportedAt: text(root.exportedAt, "导出时间", 64),
    questionCount: questions.length,
    questions,
  } satisfies QuestionPackage;
}
