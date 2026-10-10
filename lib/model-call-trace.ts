import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

type TraceContext = {
  ownerId: string;
  profileId: string;
  provider: string;
  model: string;
  purpose: string;
  documentId?: string;
  extractionRunId?: string;
  extractionAttempt?: number;
};

function safeRequestBody(body: string) {
  return JSON.parse(body, (key, value: unknown) => {
    if (/^(authorization|api[_-]?key|token|secret)$/i.test(key)) return "[redacted]";
    if (value && typeof value === "object" && "type" in value && value.type === "base64"
      && "media_type" in value && typeof value.media_type === "string" && value.media_type.startsWith("image/")
      && "data" in value && typeof value.data === "string") {
      return { ...value, data: { omittedImage: true, length: value.data.length,
        sha256: createHash("sha256").update(value.data).digest("hex") } };
    }
    if (typeof value === "string" && /^data:image\//.test(value)) {
      return { omittedImage: true, length: value.length, sha256: createHash("sha256").update(value).digest("hex") };
    }
    return value;
  }) as unknown;
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, stack: error.stack,
    code: "code" in error ? error.code : undefined,
    cause: error.cause instanceof Error ? error.cause.message : undefined };
}

/** One immutable directory per model call, independent of mutable extraction checkpoints. */
export class ModelCallTrace {
  readonly id = crypto.randomUUID();
  readonly directory: string;
  private responseNumber = 0;
  private sequence = 0;

  constructor(dataRoot: string, context: TraceContext) {
    const startedAt = new Date().toISOString();
    this.directory = path.join(dataRoot, "model-traces", startedAt.slice(0, 10), this.id);
    mkdirSync(this.directory, { recursive: true });
    this.json("manifest.json", { version: 1, traceId: this.id, startedAt, ...context });
  }

  private append(name: string, bytes: string | Uint8Array) {
    const descriptor = openSync(path.join(this.directory, name), "a", 0o600);
    try {
      writeFileSync(descriptor, bytes);
      // Commit before parsing/callbacks: malformed output and process termination retain evidence.
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
  }

  private json(name: string, value: unknown) {
    this.append(name, JSON.stringify(value, null, 2) + "\n");
  }

  event(type: string, value: unknown) {
    this.append("events.ndjson", JSON.stringify({ sequence: ++this.sequence, at: new Date().toISOString(), type, value }) + "\n");
  }

  output(kind: "text" | "thinking", delta: string) {
    this.append(kind === "text" ? "output.txt" : "thinking.txt", delta);
  }

  validation(status: "complete" | "failed", value: unknown) {
    this.json("validation.json", { status, at: new Date().toISOString(), value });
  }

  finish(status: "complete" | "failed", error?: unknown) {
    this.json("result.json", { status, finishedAt: new Date().toISOString(), error: error === undefined ? undefined : errorDetails(error) });
  }

  async fetch(endpoint: string, options: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
    const number = ++this.responseNumber;
    const url = new URL(endpoint);
    this.json(`request-${number}.json`, {
      at: new Date().toISOString(), endpoint: url.origin + url.pathname,
      method: options.method, body: typeof options.body === "string" ? safeRequestBody(options.body) : undefined,
    });
    const response = await fetcher(endpoint, options);
    const headers = Object.fromEntries(["content-type", "x-request-id", "request-id", "retry-after"]
      .flatMap(name => response.headers.has(name) ? [[name, response.headers.get(name)]] : []));
    this.json(`response-${number}.json`, { status: response.status, headers, at: new Date().toISOString() });
    if (!response.body) return response;
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.event("response-end", { number });
            controller.close();
          } else {
            this.append(`response-${number}.raw`, value);
            controller.enqueue(value);
          }
        } catch (error) {
          this.event("response-error", { number, ...errorDetails(error) });
          await reader.cancel().catch(() => undefined);
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        this.event("response-cancelled", { number, reason: String(reason ?? "") });
        await reader.cancel(reason);
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
}
