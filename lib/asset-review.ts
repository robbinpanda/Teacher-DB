import type { QuestionAsset } from "./types";
import type { AssetCandidate } from "./asset-candidates";

export type PageAssetCandidate = AssetCandidate & { page: number; pageWidth: number; pageHeight: number };

export function parseCandidateSelection(content: string, candidates: PageAssetCandidate[]) {
  const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!value || !Array.isArray(value.assets) || value.assets.length > 30 || typeof value.needsHumanReview !== "boolean"
    || typeof value.unlocatedImages !== "boolean") throw new Error("图片复核结果格式无效，请重试");
  const seen = new Set<string>();
  const assets: QuestionAsset[] = value.assets.map((item: Record<string, unknown>) => {
    const candidate = item && candidates.find((c) => c.id === item.id);
    if (!candidate || seen.has(candidate.id) || !["figure", "table", "graph"].includes(String(item.kind))
      || !["question", "answer"].includes(String(item.role))) throw new Error("图片复核选择了无效或重复的候选框，请重试");
    seen.add(candidate.id);
    return { id: crypto.randomUUID(), page: candidate.page, kind: item.kind as QuestionAsset["kind"],
      role: item.role as QuestionAsset["role"], label: String(item.label ?? "复核图片").slice(0, 100),
      bbox: { x: candidate.x / candidate.pageWidth * 100, y: candidate.y / candidate.pageHeight * 100,
        width: candidate.width / candidate.pageWidth * 100, height: candidate.height / candidate.pageHeight * 100 } };
  });
  return { assets, needsHumanReview: value.needsHumanReview || value.unlocatedImages,
    notes: `${String(value.notes ?? "").slice(0, 1500)}${value.unlocatedImages ? " 有图片未能可靠定位，请手动补框。" : ""}` };
}
