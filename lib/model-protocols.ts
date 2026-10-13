import { isOpenCodeEndpoint, normalizeModelService } from "./model-services.ts";

export const MODEL_PROTOCOLS = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generate-content",
] as const;

export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number];

export const MODEL_PROTOCOL_LABELS: Record<ModelProtocol, string> = {
  "openai-chat-completions": "Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generate-content": "Gemini GenerateContent",
};

export function normalizeModelProtocol(value: string): ModelProtocol {
  if (value === "openai-compatible") return "openai-chat-completions";
  if ((MODEL_PROTOCOLS as readonly string[]).includes(value)) return value as ModelProtocol;
  throw new Error(`不支持的模型接口协议：${value || "空值"}`);
}

export function endpointForProtocol(baseUrl: string, protocolValue: string, model?: string, stream = false) {
  const protocol = normalizeModelProtocol(protocolValue);
  if (protocol === "google-generate-content") {
    if (!model) throw new Error("Gemini 请求缺少模型名称");
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "");
    const base = path.replace(/\/models\/[^/]+(?::(?:streamGenerateContent|generateContent))?$/, "");
    url.pathname = `${base}/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent" : "generateContent"}`;
    if (stream) url.searchParams.set("alt", "sse");
    else url.searchParams.delete("alt");
    return url.toString();
  }
  const suffix = protocol === "openai-chat-completions"
    ? "/chat/completions"
    : protocol === "openai-responses"
      ? "/responses"
      : "/messages";
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith(suffix)) url.pathname = path + suffix;
  return url.toString();
}

type VisionImage = { page: number; dataUrl: string; label?: string };

type VisionRequestInput = {
  service?: string | null;
  sessionId?: string;
  protocol: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  text: string;
  images: VisionImage[];
  jsonMode?: boolean;
  stream?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
};

export type VisionHttpRequest = {
  protocol: ModelProtocol;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function anthropicImage(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Anthropic Messages 仅支持 base64 编码的 JPEG、PNG、GIF 或 WebP 图片");
  return {
    type: "image",
    source: { type: "base64", media_type: match[1], data: match[2] },
  };
}

export function buildVisionHttpRequest(input: VisionRequestInput): VisionHttpRequest {
  const request = buildProtocolRequest(input);
  if (normalizeModelService(input.service, input.baseUrl) === "opencode") {
    if (!isOpenCodeEndpoint(request.endpoint)) throw new Error("OpenCode 配置只能向官方 inference 地址发送密钥");
    const sessionId = input.sessionId ?? crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) throw new Error("OpenCode session ID 格式无效");
    delete request.headers["x-api-key"];
    delete request.headers["x-goog-api-key"];
    request.headers.authorization = `Bearer ${input.apiKey}`;
    request.headers["x-opencode-session"] = sessionId;
    request.headers["user-agent"] = "Jianti-Teacher-Question-Bank/0.1.0";
    // Console routes heterogeneous models: do not force an OpenAI-only reasoning option.
    delete request.body.reasoning_effort;
    delete request.body.reasoning;
  }
  return request;
}

function buildProtocolRequest(input: VisionRequestInput): VisionHttpRequest {
  const protocol = normalizeModelProtocol(input.protocol);
  const endpoint = endpointForProtocol(input.baseUrl, protocol, input.model, input.stream);

  if (protocol === "google-generate-content") {
    const parts: Array<Record<string, unknown>> = [{ text: input.text }];
    for (const image of input.images) {
      const parsed = anthropicImage(image.dataUrl).source;
      parts.push({ text: image.label ?? `下面是原试卷第 ${image.page} 页：` },
        { inlineData: { mimeType: parsed.media_type, data: parsed.data } });
    }
    return { protocol, endpoint,
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: { systemInstruction: { parts: [{ text: input.system }] }, contents: [{ role: "user", parts }],
        generationConfig: { temperature: input.temperature ?? 0,
          ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
          ...(input.jsonMode ? { responseMimeType: "application/json" } : {}) } } };
  }

  if (protocol === "anthropic-messages") {
    const content: Array<Record<string, unknown>> = [];
    for (const image of input.images) {
      content.push({ type: "text", text: image.label ?? `下面是原试卷第 ${image.page} 页：` });
      content.push(anthropicImage(image.dataUrl));
    }
    content.push({ type: "text", text: input.text });
    return {
      protocol,
      endpoint,
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: input.model,
        max_tokens: input.maxOutputTokens ?? 32768,
        temperature: input.temperature ?? 0,
        system: input.system,
        messages: [{ role: "user", content }],
        ...(input.stream ? { stream: true } : {}),
      },
    };
  }

  if (protocol === "openai-responses") {
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: input.text }];
    for (const image of input.images) {
      content.push({ type: "input_text", text: image.label ?? `下面是原试卷第 ${image.page} 页：` });
      content.push({ type: "input_image", image_url: image.dataUrl, detail: "high" });
    }
    const body: Record<string, unknown> = {
      model: input.model,
      instructions: input.system,
      input: [{ role: "user", content }],
      reasoning: { effort: "none" },
      temperature: input.temperature ?? 0,
    };
    if (input.maxOutputTokens) body.max_output_tokens = input.maxOutputTokens;
    if (input.jsonMode) body.text = { format: { type: "json_object" } };
    if (input.stream) body.stream = true;
    return {
      protocol,
      endpoint,
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body,
    };
  }

  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.text }];
  for (const image of input.images) {
    content.push({ type: "text", text: image.label ?? `下面是原试卷第 ${image.page} 页：` });
    content.push({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } });
  }
  const body: Record<string, unknown> = {
    model: input.model,
    reasoning_effort: "none",
    temperature: input.temperature ?? 0,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content },
    ],
  };
  if (input.maxOutputTokens) body.max_tokens = input.maxOutputTokens;
  if (input.jsonMode) body.response_format = { type: "json_object" };
  if (input.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return {
    protocol,
    endpoint,
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body,
  };
}

export type VisionStreamEvent = {
  textDelta?: string;
  thinkingDelta?: string;
  done?: boolean;
  error?: string;
  usagePayload?: unknown;
};

function stringFromUnknownContent(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((block) => {
    const item = objectValue(block);
    const text = item?.text ?? item?.content;
    return typeof text === "string" ? [text] : [];
  }).join("");
}

/** Turns one provider SSE payload into the common text/thinking activity protocol. */
export function extractVisionStreamEvent(protocolValue: string, data: string): VisionStreamEvent {
  const protocol = normalizeModelProtocol(protocolValue);
  if (data.trim() === "[DONE]") return { done: true };
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return {};
  }
  const event = objectValue(value);
  if (!event) return {};
  const providerError = objectValue(event.error);
  if (providerError) return { error: String(providerError.message ?? providerError.type ?? "模型流返回错误") };

  if (protocol === "google-generate-content") {
    const candidate = objectValue(Array.isArray(event.candidates) ? event.candidates[0] : null);
    const content = objectValue(candidate?.content);
    const parts = Array.isArray(content?.parts) ? content.parts.map(objectValue) : [];
    const blocked = objectValue(event.promptFeedback)?.blockReason;
    const finish = candidate?.finishReason;
    if (blocked || (finish && finish !== "STOP" && finish !== "MAX_TOKENS")) return { error: `Gemini 返回 ${blocked ?? finish}` };
    return { textDelta: parts.filter(p => !p?.thought).map(p => typeof p?.text === "string" ? p.text : "").join(""),
      thinkingDelta: parts.filter(p => p?.thought).map(p => typeof p?.text === "string" ? p.text : "").join(""),
      ...(event.usageMetadata ? { usagePayload: event } : {}), ...(finish ? { done: true } : {}) };
  }

  if (protocol === "anthropic-messages") {
    const type = String(event.type ?? "");
    if (type === "error") {
      const detail = objectValue(event.error);
      return { error: String(detail?.message ?? "Anthropic 流返回错误") };
    }
    if (type === "content_block_delta") {
      const delta = objectValue(event.delta);
      if (delta?.type === "text_delta" && typeof delta.text === "string") return { textDelta: delta.text };
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") return { thinkingDelta: delta.thinking };
    }
    if (type === "message_delta") return { usagePayload: event };
    if (type === "message_stop") return { done: true };
    return {};
  }

  if (protocol === "openai-responses") {
    const type = String(event.type ?? "");
    if (type === "response.output_text.delta" && typeof event.delta === "string") return { textDelta: event.delta };
    if ((type.includes("reasoning") || type.includes("thinking")) && type.endsWith(".delta")) {
      return { thinkingDelta: stringFromUnknownContent(event.delta) || String(event.delta ?? "") };
    }
    if (type === "response.completed") return { done: true, usagePayload: event.response };
    if (type === "response.failed" || type === "error") {
      const response = objectValue(event.response);
      const detail = objectValue(response?.error) ?? objectValue(event.error);
      return { error: String(detail?.message ?? "Responses 流返回错误") };
    }
    return {};
  }

  const choices = Array.isArray(event.choices) ? event.choices : [];
  const first = objectValue(choices[0]);
  const delta = objectValue(first?.delta);
  const textDelta = stringFromUnknownContent(delta?.content);
  const thinkingDelta = stringFromUnknownContent(delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking);
  return {
    ...(textDelta ? { textDelta } : {}),
    ...(thinkingDelta ? { thinkingDelta } : {}),
    ...(event.usage ? { usagePayload: event } : {}),
    ...(first?.finish_reason ? { done: true } : {}),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function textFromBlocks(value: unknown, acceptedTypes: string[]) {
  if (!Array.isArray(value)) return "";
  return value.flatMap((block) => {
    const item = objectValue(block);
    if (!item || !acceptedTypes.includes(String(item.type)) || typeof item.text !== "string") return [];
    return [item.text];
  }).join("");
}

export function extractVisionResponseText(protocolValue: string, value: unknown) {
  const protocol = normalizeModelProtocol(protocolValue);
  const result = objectValue(value);
  if (!result) return "";

  if (protocol === "google-generate-content") {
    const event = extractVisionStreamEvent(protocol, JSON.stringify(result));
    if (event.error) throw new Error(event.error);
    return event.textDelta?.trim() ?? "";
  }

  if (protocol === "anthropic-messages") {
    return textFromBlocks(result.content, ["text"]).trim();
  }

  if (protocol === "openai-responses") {
    if (typeof result.output_text === "string") return result.output_text.trim();
    if (!Array.isArray(result.output)) return "";
    return result.output.flatMap((output) => {
      const item = objectValue(output);
      return item ? [textFromBlocks(item.content, ["output_text", "text"])] : [];
    }).join("").trim();
  }

  if (!Array.isArray(result.choices)) return "";
  const first = objectValue(result.choices[0]);
  const message = objectValue(first?.message);
  if (typeof message?.content === "string") return message.content.trim();
  return textFromBlocks(message?.content, ["text", "output_text"]).trim();
}
