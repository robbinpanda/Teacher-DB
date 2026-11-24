import type { QuestionWithSource } from "./types";
import { typeLabels } from "./question-labels.ts";

/** Alternate available question types so short weekly drafts also have variety. */
export function chooseTeachingDraft(questions: QuestionWithSource[], count: number) {
  const unique = [...new Map(questions.map(q => [q.id, q])).values()];
  const groups = Object.keys(typeLabels).map(type => unique.filter(q => q.type === type));
  const size = Math.min(unique.length, Math.max(1, Math.min(50, Math.round(count) || 12)));
  const chosen: QuestionWithSource[] = [];
  for (let index = 0; index < unique.length && chosen.length < size; index++) {
    for (const group of groups) {
      if (group[index] && chosen.length < size) chosen.push(group[index]);
    }
  }
  return chosen;
}

export function teachingDistribution(questions: QuestionWithSource[]) {
  const types: Record<string, number> = {};
  const knowledge: Record<string, number> = Object.create(null);
  for (const question of questions) {
    const label = typeLabels[question.type];
    types[label] = (types[label] ?? 0) + 1;
    for (const tag of new Set(question.tags)) knowledge[tag] = (knowledge[tag] ?? 0) + 1;
  }
  return { types, knowledge };
}
