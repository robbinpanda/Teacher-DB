import type { ChapterContent } from "./authoring-content.ts";

/** Only authored teaching text is evidence; IDs, instructions and old reviews are not. */
export function chapterReviewPassages(content: ChapterContent) {
  const passages: Array<{ path: string; text: string }> = [];
  const add = (path: string, text: string) => { if (text.trim()) passages.push({ path, text }); };
  add("introduction", content.introduction);
  content.knowledge.forEach((knowledge, index) => {
    const root = `knowledge.${index}`;
    add(`${root}.explanation`, knowledge.explanation);
    add(`${root}.method`, knowledge.method);
    knowledge.formulas.forEach((formula, index) => {
      add(`${root}.formulas.${index}.latex`, formula.latex);
      add(`${root}.formulas.${index}.conditions`, formula.conditions);
    });
    knowledge.misconceptions.forEach((item, index) => {
      add(`${root}.misconceptions.${index}.mistake`, item.mistake);
      add(`${root}.misconceptions.${index}.correction`, item.correction);
    });
  });
  content.items.forEach((item, index) => add(`items.${index}.teachingExplanation`, item.teachingExplanation));
  add("conclusion", content.conclusion);
  return passages;
}

/** Deterministic, verbatim excerpts let reviewers cite instead of retyping mathematics. */
export function chapterReviewEvidence(content: ChapterContent) {
  return chapterReviewPassages(content).flatMap(passage => {
    const segments: Array<{ ref: string; path: string; text: string }> = [];
    let offset = 0;
    while (offset < passage.text.length) {
      const remaining = passage.text.slice(offset);
      let length = Math.min(700, remaining.length);
      if (remaining.length > length) {
        const prefix = remaining.slice(0, length);
        const boundary = Math.max(...["。", "；", "\n", "！", "？"].map(mark => prefix.lastIndexOf(mark)));
        if (boundary >= 350) length = boundary + 1;
        // Do not split a UTF-16 surrogate pair at the hard boundary.
        else if (/[\uD800-\uDBFF]/.test(remaining[length - 1])) length--;
      }
      const text = remaining.slice(0, length);
      segments.push({ ref: `${passage.path}:${segments.length}`, path: passage.path, text });
      offset += length;
    }
    return segments;
  });
}
