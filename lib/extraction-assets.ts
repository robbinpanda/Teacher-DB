import type { BoundingBox } from "./types";

export type StoredExtractionAsset = {
  id: string;
  pageId: string | null;
  bbox: BoundingBox;
};

export function assetOverlapRatio(left: BoundingBox, right: BoundingBox) {
  const intersectionWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const intersectionHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = intersectionWidth * intersectionHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? intersection / smallerArea : 0;
}

export function findMatchingAsset(candidates: StoredExtractionAsset[], pageId: string | null, bbox: BoundingBox) {
  return candidates
    .filter((candidate) => candidate.pageId === pageId)
    .map((candidate) => ({ candidate, overlap: assetOverlapRatio(candidate.bbox, bbox) }))
    .filter(({ overlap }) => overlap >= 0.72)
    .sort((left, right) => right.overlap - left.overlap)[0]?.candidate;
}
