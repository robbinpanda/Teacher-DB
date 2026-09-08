export type QuestionProvenance = {
  parentQuestionId?: string | null;
  parentExternalId?: string | null;
  variationKind?: string | null;
  variationReview?: unknown;
};

// Local parent links may be absent after sharing or deletion. The other
// provenance fields must continue to identify historical/imported variations.
export function isVariationQuestion(question: QuestionProvenance) {
  return Boolean(question.parentQuestionId || question.parentExternalId || question.variationKind || question.variationReview);
}
