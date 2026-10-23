/** Accept raw JSON or one explicitly fenced JSON block, never guess between competing objects. */
export function parseStructuredModelJson(content: string): unknown {
  const text = content.trim();
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  const blocks = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  if (blocks.length !== 1) throw new Error("模型必须返回一个明确的 JSON 对象");
  const block = blocks[0];
  const outside = text.slice(0, block.index) + text.slice(block.index! + block[0].length);
  if (/```|[{}]/.test(outside)) throw new Error("模型返回多个或含糊的结构化结果");
  return JSON.parse(block[1].trim());
}
