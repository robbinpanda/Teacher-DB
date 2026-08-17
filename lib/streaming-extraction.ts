export type ExtractionStreamRecord =
  | { event: "meta"; questionCount: number; documentMeta?: Record<string, unknown> }
  | { event: "question"; question: Record<string, unknown> }
  | { event: "done" };

function validateRecord(value: unknown): ExtractionStreamRecord {
  if (!value || typeof value !== "object") throw new Error("模型流事件不是 JSON 对象");
  const record = value as Record<string, unknown>;
  if (record.event === "meta") {
    const questionCount = Number(record.questionCount);
    if (!Number.isInteger(questionCount) || questionCount < 1) throw new Error("模型 meta 事件缺少有效 questionCount");
    return {
      event: "meta",
      questionCount,
      documentMeta: record.documentMeta && typeof record.documentMeta === "object"
        ? record.documentMeta as Record<string, unknown>
        : {},
    };
  }
  if (record.event === "question") {
    if (!record.question || typeof record.question !== "object") throw new Error("模型 question 事件缺少 question 对象");
    return { event: "question", question: record.question as Record<string, unknown> };
  }
  if (record.event === "done") return { event: "done" };
  throw new Error(`未知模型流事件：${String(record.event ?? "空值")}`);
}

/** Extracts balanced top-level JSON objects so both NDJSON and pretty-printed events work. */
export class ExtractionStreamParser {
  private buffer = "";

  push(delta: string) {
    this.buffer += delta;
    return this.drain(false);
  }

  finish() {
    const records = this.drain(true);
    const rest = this.buffer.replace(/```(?:json)?/gi, "").trim();
    if (rest) throw new Error("模型流末尾存在未完成的 JSON 事件");
    this.buffer = "";
    return records;
  }

  private drain(final: boolean) {
    const records: ExtractionStreamRecord[] = [];
    let start = -1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let consumed = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (start < 0) {
        if (character === "{") {
          start = index;
          depth = 1;
        }
        continue;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") quoted = false;
        continue;
      }
      if (character === "\"") quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const raw = this.buffer.slice(start, index + 1);
          try {
            records.push(validateRecord(JSON.parse(raw)));
          } catch {
            const repaired = raw.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
            records.push(validateRecord(JSON.parse(repaired)));
          }
          consumed = index + 1;
          start = -1;
        }
      }
    }
    if (consumed) this.buffer = this.buffer.slice(consumed);
    if (final && start >= 0) throw new Error("模型流在 JSON 事件中途结束");
    return records;
  }
}
