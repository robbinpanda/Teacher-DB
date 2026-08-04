import type { Question } from "./types";

export function mergeContinuationText(existing: string, addition: string) {
  const before = existing.trim();
  const next = addition.trim();
  if (!next) return before;
  if (!before) return next;
  const compactBefore = before.replace(/\s+/g, " ");
  const compactNext = next.replace(/\s+/g, " ");
  if (compactBefore.includes(compactNext)) return before;
  if (compactNext.includes(compactBefore)) return next;
  const maxOverlap = Math.min(before.length, next.length, 600);
  for (let length = maxOverlap; length >= 12; length -= 1) {
    if (before.slice(-length) === next.slice(0, length)) return before + next.slice(length);
  }
  return `${before}\n${next}`;
}

export function mergeQuestionOptions(existingJson: string | null, additions: Question["options"]) {
  const existing = (() => {
    try { return JSON.parse(existingJson ?? "[]") as NonNullable<Question["options"]>; } catch { return []; }
  })();
  const merged = new Map(existing.map((option) => [option.key, option]));
  for (const option of additions ?? []) {
    const current = merged.get(option.key);
    merged.set(option.key, current ? { ...current, content: mergeContinuationText(current.content, option.content) } : option);
  }
  return Array.from(merged.values());
}

export function subquestionMarkers(text: string) {
  const markers = new Set<string>();
  for (const match of text.matchAll(/(?:[（(]\s*(\d{1,2})\s*[）)]|【\s*小问\s*(\d{1,2}))/g)) {
    markers.add(match[1] ?? match[2]);
  }
  return markers;
}

export function hasIncompleteSubquestionAnalysis(stem: string, analysis: string) {
  const expected = subquestionMarkers(stem);
  const resolved = subquestionMarkers(analysis);
  return expected.size >= 2 && resolved.size > 0
    && Array.from(expected).some((marker) => !resolved.has(marker));
}
