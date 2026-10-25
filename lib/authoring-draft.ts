import { z } from "zod";
import { chapterContentSchema, type ChapterContent } from "./authoring-content.ts";

type Selection = {
  items: Array<Pick<ChapterContent["items"][number], "questionId" | "slotIndex" | "selectionReason">>;
  gaps: ChapterContent["gaps"];
};
const draftSchema = chapterContentSchema.omit({ items: true, gaps: true }).extend({
  items: z.array(z.object({ questionId: z.string().min(1).max(100), teachingExplanation: z.string().max(8000) }).strict()).max(30),
}).strict();

/** The writer owns prose; the completed selection owns question identity and quotas. */
export function resolveChapterDraft(value: unknown, selection: Selection) {
  const legacy = !!value && typeof value === "object" && "gaps" in value;
  const draft = legacy ? chapterContentSchema.parse(value) : draftSchema.parse(value);
  if (draft.items.length !== selection.items.length || new Set(draft.items.map(item => item.questionId)).size !== draft.items.length || selection.items.some(item => !draft.items.some(other => other.questionId === item.questionId))) {
    throw new Error("正文必须为每道已选题恰好返回一项讲解，不能遗漏、重复、替换或新增题目。发现原题有问题时保留题目并说明问题，由独立审校核对。");
  }
  if (legacy) {
    const full = draft as ChapterContent;
    if (selection.items.some(item => !full.items.some(other => other.questionId === item.questionId && other.slotIndex === item.slotIndex)) || JSON.stringify(full.gaps) !== JSON.stringify(selection.gaps)) {
      throw new Error("正文不能改变已选题目、分组或真实缺口。请按新协议只返回知识正文和 items:[{questionId,teachingExplanation}]，不要返回 gaps、slotIndex 或 selectionReason。");
    }
  }
  return { ...draft, items: selection.items.map(item => ({ ...item, teachingExplanation: draft.items.find(other => other.questionId === item.questionId)!.teachingExplanation })), gaps: selection.gaps };
}
