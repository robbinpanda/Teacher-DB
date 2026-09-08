import type { BoundingBox, Question } from "./types";

const questionTypes = new Set(["single", "multiple", "fill", "answer"]);
const questionStatuses = new Set(["pending", "approved", "needs_attention"]);
const assetKinds = new Set(["figure", "table", "graph"]);
const assetRoles = new Set(["question", "answer"]);

function isBoundedString(value: unknown, maxLength: number, allowEmpty = true) {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function isPage(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10_000;
}

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const box = value as Record<string, unknown>;
  return [box.x, box.y, box.width, box.height].every((number) => typeof number === "number" && Number.isFinite(number));
}

export function validateQuestionPayload(value: Record<string, unknown>): string | null {
  if (!isBoundedString(value.number, 20, false)) return "题号格式无效";
  if (typeof value.type !== "string" || !questionTypes.has(value.type)) return "题型无效";
  if (!isBoundedString(value.stem, 50_000, false)) return "题干为空或过长";
  if (!isBoundedString(value.answer, 50_000) || !isBoundedString(value.analysis, 100_000)) return "答案或解析格式无效";
  if (!isPage(value.page) || !isBoundingBox(value.bbox)) return "题目页码或范围无效";
  if (typeof value.status !== "string" || !questionStatuses.has(value.status)) return "审核状态无效";
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)) return "置信度无效";
  if (typeof value.needsHumanReview !== "boolean") return "人工复核状态无效";

  if (value.options !== undefined && (!Array.isArray(value.options) || value.options.length > 20
    || value.options.some((option) => !option || typeof option !== "object" || Array.isArray(option)
      || !isBoundedString((option as Record<string, unknown>).key, 20, false)
      || !isBoundedString((option as Record<string, unknown>).content, 20_000)))) {
    return "选项格式无效";
  }
  if (!Array.isArray(value.tags) || value.tags.length > 32
    || value.tags.some((tag) => !isBoundedString(tag, 32, false))) return "标签格式无效";
  if (value.regions !== undefined && (!Array.isArray(value.regions) || value.regions.length > 12
    || value.regions.some((region) => !region || typeof region !== "object" || Array.isArray(region)
      || !isPage((region as Record<string, unknown>).page)
      || !isBoundingBox((region as Record<string, unknown>).bbox)))) {
    return "题目跨页范围格式无效";
  }
  if (!Array.isArray(value.assets) || value.assets.length > 32
    || value.assets.some((asset) => !asset || typeof asset !== "object" || Array.isArray(asset)
      || !isBoundedString((asset as Record<string, unknown>).id, 100, false)
      || typeof (asset as Record<string, unknown>).kind !== "string"
      || !assetKinds.has((asset as Record<string, unknown>).kind as string)
      || typeof (asset as Record<string, unknown>).role !== "string"
      || !assetRoles.has((asset as Record<string, unknown>).role as string)
      || !isPage((asset as Record<string, unknown>).page)
      || !isBoundingBox((asset as Record<string, unknown>).bbox)
      || !isBoundedString((asset as Record<string, unknown>).label, 500))) {
    return "题图格式无效";
  }
  return null;
}

export function asQuestionPayload(value: Record<string, unknown>) {
  return value as unknown as Question;
}
