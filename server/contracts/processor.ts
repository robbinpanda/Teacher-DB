import { z } from "zod";

export const processorEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("metadata"), protocolVersion: z.literal(1), pageCount: z.number().int().min(1).max(250) }),
  z.object({ type: z.literal("page"), pageNumber: z.number().int().min(1).max(250), width: z.number().int().min(1).max(50000), height: z.number().int().min(1).max(50000), jpeg: z.string().min(1).max(28_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
  z.object({ type: z.literal("complete"), pageCount: z.number().int().min(1).max(250) }),
  z.object({ type: z.literal("error"), error: z.string().max(2000) }),
]);

export async function* readProcessorEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) yield processorEvent.parse(JSON.parse(line));
      }
      if (pending.length > 28_100_000) throw new Error("PDF 处理服务响应过大");
      if (done) {
        if (pending.trim()) throw new Error("PDF 处理服务响应被截断");
        break;
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
