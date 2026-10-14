/** Content integrity is mandatory even when optional AI review is disabled. */
export function extractionResumeState<T extends { number: string; stem: string }>(questions: T[]) {
  const completed = questions.filter(row => /^[1-9]\d*$/.test(row.number) && row.stem.trim());
  const numbers = new Set(completed.map(row => row.number));
  let nextNumber = 1;
  while (numbers.has(String(nextNumber))) nextNumber++;
  return { completed, nextNumber };
}

export function extractionCompletenessError(
  questions: Iterable<{ number: string; stem: string }>,
  expectedTotal: number | null,
  receivedDone: boolean,
) {
  const rows = Array.from(questions);
  if (!rows.length) return "模型未返回任何可用题目，需要重新识别";
  const empty = rows.filter(row => !row.stem.trim()).map(row => row.number);
  if (empty.length) return `第 ${empty.join("、")} 题题干为空，需要重新识别`;
  const total = expectedTotal ?? Math.max(...rows.map(row => Number(row.number)));
  const numbers = new Set(rows.map(row => row.number));
  const unexpected = rows.filter(row => !/^[1-9]\d*$/.test(row.number) || Number(row.number) > total).map(row => row.number);
  if (unexpected.length) return `题号 ${unexpected.join("、")} 超过原卷总题数 ${total}，需要核对，不能继续追加题号`;
  const missing = Array.from({ length: total }, (_, index) => String(index + 1)).filter(number => !numbers.has(number));
  if (missing.length) return `模型漏识别第 ${missing.join("、")} 题，需要重新识别`;
  if (!receivedDone) return "模型输出中断，未收到结束事件，需要重新识别";
  return null;
}
