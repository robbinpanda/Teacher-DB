export type ExtractionStreamRecord =
  | { event: "meta"; questionCount: number; documentMeta?: Record<string, unknown> }
  | { event: "question"; question: Record<string, unknown>; warning?: string; raw?: string }
  | { event: "issue"; message: string; raw: string; number?: string }
  | { event: "done" };

function validateRecord(value: unknown): ExtractionStreamRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型流事件不是 JSON 对象");
  const record = value as Record<string, unknown>;
  if (record.event === "meta") {
    const questionCount = Number(record.questionCount);
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 1000) throw new Error("模型 meta 事件缺少有效 questionCount（1～1000）");
    return { event: "meta", questionCount, documentMeta: record.documentMeta as Record<string, unknown> ?? {} };
  }
  if (record.event === "question") {
    if (!record.question || typeof record.question !== "object" || Array.isArray(record.question)) throw new Error("模型 question 事件缺少 question 对象");
    return { event: "question", question: record.question as Record<string, unknown> };
  }
  if (record.event === "done") return { event: "done" };
  throw new Error(`未知模型流事件：${String(record.event ?? "空值")}`);
}

function decode(raw: string): ExtractionStreamRecord {
  try { return validateRecord(JSON.parse(raw)); } catch { /* Keep the original before conservative repairs. */ }
  const escaped = raw.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
  // Never invent content: only try a missing outer delimiter or an invalid LaTeX escape.
  for (const candidate of [escaped, `{${escaped}`, `${escaped}}`]) {
    try {
      const record = validateRecord(JSON.parse(candidate));
      if (record.event === "question") return { ...record, raw, warning: "本题 JSON 格式损坏，已恢复可解析字段，请对照原卷核对" };
    } catch { /* The next event must still be processed. */ }
  }
  const number = raw.match(/"question"\s*:\s*\{\s*"number"\s*:\s*"?([1-9]\d{0,2})(?:"|\s*[,}])/)
    ?? raw.match(/"number"\s*:\s*"([1-9]\d{0,2})"/);
  return { event: "issue", raw, number: number?.[1], message: "本题 JSON 无法解析，请对照原始返回和原卷补录" };
}

/** Balanced JSON framing with resynchronization at the next protocol event.
 * A broken question must never swallow the rest of the document or an earlier record.
 */
export class ExtractionStreamParser {
  private buffer = "";

  push(delta: string) { this.buffer += delta; return this.drain(false); }
  finish() { return this.drain(true); }

  private drain(final: boolean) {
    const records: ExtractionStreamRecord[] = [];
    let start = -1, depth = 0, consumed = 0;
    let quoted = false, escaped = false, missingOpen = false;
    for (let index = 0; index < this.buffer.length; index++) {
      const character = this.buffer[index];
      // JSON strings cannot contain literal line breaks. A fresh event on a new
      // line is therefore also a safe boundary after an unterminated string.
      const lineStart = index === 0 || /\n[\t ]*$/.test(this.buffer.slice(Math.max(0, index - 100), index));
      const header = (character === "{" || character === '"') && (!quoted || lineStart)
        && /^(?:\{\s*)?"event"\s*:\s*"(?:question|meta|done)"/.test(this.buffer.slice(index));
      if (header && (start < 0 || index > start && (character === "{" || lineStart && this.buffer.slice(start, index).trim() !== "{"))) {
        if (start >= 0) records.push(decode(this.buffer.slice(start, index).trim()));
        else if (this.buffer.slice(consumed, index).replace(/```(?:json)?/gi, "").trim()) {
          records.push({ event: "issue", raw: this.buffer.slice(consumed, index), message: "模型事件之间出现额外内容" });
        }
        start = index; consumed = index; depth = 0; quoted = false; escaped = false;
        missingOpen = character !== "{";
      }
      if (start < 0) {
        if (character !== "{") continue;
        start = index; depth = 0; missingOpen = false;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}") {
        depth--;
        if ((!missingOpen && depth === 0) || (missingOpen && depth === -1)) {
          records.push(decode(this.buffer.slice(start, index + 1)));
          consumed = index + 1; start = -1;
        }
      }
    }
    this.buffer = this.buffer.slice(consumed);
    if (final) {
      const rest = this.buffer.replace(/```(?:json)?/gi, "").trim();
      if (rest) records.push(decode(rest));
      this.buffer = "";
    }
    return records;
  }
}
