export function resolveInitialPaperQuestions<T extends { id: string }>(questions: T[], initialIds: string[]) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  return Array.from(new Set(initialIds)).flatMap((id) => {
    const question = byId.get(id);
    return question ? [question] : [];
  });
}
