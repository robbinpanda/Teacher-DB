export async function persistDirtyQuestionDrafts<T extends { id: string }>(input: {
  questions: T[];
  dirtyQuestionIds: ReadonlySet<string>;
  persist: (question: T) => Promise<void>;
}) {
  const drafts = input.questions.filter((question) => input.dirtyQuestionIds.has(question.id));
  for (const draft of drafts) await input.persist(draft);
  return drafts.map((draft) => draft.id);
}
