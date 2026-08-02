import type { QuestionType } from "./types";

export const typeLabels: Record<QuestionType, string> = {
  single: "单选题",
  multiple: "多选题",
  fill: "填空题",
  answer: "解答题",
};
