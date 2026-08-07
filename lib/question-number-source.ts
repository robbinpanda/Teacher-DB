export type QuestionNumberSource = "printed" | "continuation";

export function isValidQuestionNumber(number: string) {
  return /^[1-9]\d*$/.test(number);
}

export function acceptsQuestionNumberSource(
  number: string,
  source: unknown,
  continuationNumbers: ReadonlySet<string>,
) {
  if (!isValidQuestionNumber(number)) return false;
  if (source === "printed") return true;
  if (source === "continuation") return continuationNumbers.has(number);
  return false;
}
