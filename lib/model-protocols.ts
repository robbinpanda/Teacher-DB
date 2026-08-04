export const MODEL_PROTOCOLS = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
] as const;

export type ModelProtocol = (typeof MODEL_PROTOCOLS)[number];

export const MODEL_PROTOCOL_LABELS: Record<ModelProtocol, string> = {
  "openai-chat-completions": "Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

export function normalizeModelProtocol(value: string): ModelProtocol {
  if (value === "openai-compatible") return "openai-chat-completions";
  if ((MODEL_PROTOCOLS as readonly string[]).includes(value)) return value as ModelProtocol;
  throw new Error(`不支持的模型接口协议：${value || "空值"}`);
}

export function endpointForProtocol(baseUrl: string, protocolValue: string) {
  const protocol = normalizeModelProtocol(protocolValue);
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

type VisionImage = { page: number; dataUrl: string };

type VisionRequestInput = {
  protocol: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  text: string;
  images: VisionImage[];
  jsonMode?: boolean;
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
  const protocol = normalizeModelProtocol(input.protocol);
  const endpoint = endpointForProtocol(input.baseUrl, protocol);

  if (protocol === "anthropic-messages") {
    const content: Array<Record<string, unknown>> = [];
    for (const image of input.images) {
      content.push({ type: "text", text: `下面是原试卷第 ${image.page} 页：` });
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
        max_tokens: 8192,
        temperature: 0,
        system: input.system,
        messages: [{ role: "user", content }],
      },
    };
  }

  if (protocol === "openai-responses") {
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: input.text }];
    for (const image of input.images) {
      content.push({ type: "input_text", text: `下面是原试卷第 ${image.page} 页：` });
      content.push({ type: "input_image", image_url: image.dataUrl, detail: "high" });
    }
    const body: Record<string, unknown> = {
      model: input.model,
      instructions: input.system,
      input: [{ role: "user", content }],
      reasoning: { effort: "none" },
      temperature: 0,
    };
    if (input.jsonMode) body.text = { format: { type: "json_object" } };
    return {
      protocol,
      endpoint,
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body,
    };
  }

  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.text }];
  for (const image of input.images) {
    content.push({ type: "text", text: `下面是原试卷第 ${image.page} 页：` });
    content.push({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } });
  }
  const body: Record<string, unknown> = {
    model: input.model,
    reasoning_effort: "none",
    temperature: 0,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content },
    ],
  };
  if (input.jsonMode) body.response_format = { type: "json_object" };
  return {
    protocol,
    endpoint,
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body,
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
