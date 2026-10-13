import type { VisionHttpRequest } from "./model-protocols.ts";

// Keep provider-native controls: hiding reasoning text does not disable its computation.
// https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
// https://mimo.mi.com/models/en-US/mimo-v2.6-flash
// https://api-docs.deepseek.com/guides/thinking_mode/
// https://docs.z.ai/guides/capabilities/thinking-mode
export function disableModelThinking(request: VisionHttpRequest, service: string, model: string) {
  const { body, protocol } = request;
  if (protocol === "anthropic-messages") {
    body.thinking = { type: "disabled" };
  } else if (protocol === "google-generate-content") {
    (body.generationConfig as Record<string, unknown>).thinkingConfig = { thinkingBudget: 0 };
  } else if (service === "openrouter") {
    delete body.reasoning_effort;
    body.reasoning = { enabled: false, effort: "none" };
  } else if (protocol === "openai-responses") {
    body.reasoning = { effort: "none" };
  } else {
    const name = model.toLowerCase().split("/").at(-1) ?? "";
    if (/^(mimo|glm|deepseek|kimi|claude)(?:-|\d)/.test(name)) {
      delete body.reasoning_effort;
      body.thinking = { type: "disabled" };
    } else if (/^qwen/.test(name)) {
      delete body.reasoning_effort;
      body.enable_thinking = false;
    } else {
      body.reasoning_effort = "none";
    }
  }
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const nonempty = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) && value.length > 0;

/** Also checks reported token usage when a provider conceals the reasoning text. */
export function hasModelThinking(value: unknown): boolean {
  const result = object(value);
  const usage = object(result.usage);
  if ([object(usage.completion_tokens_details).reasoning_tokens, object(usage.output_tokens_details).reasoning_tokens,
    usage.reasoning_tokens, object(result.usageMetadata).thoughtsTokenCount].some(count => typeof count === "number" && count > 0)) return true;
  if (Array.isArray(result.content) && result.content.some(block => ["thinking", "redacted_thinking"].includes(String(object(block).type)))) return true;
  if (Array.isArray(result.output) && result.output.some(block => object(block).type === "reasoning")) return true;
  if (Array.isArray(result.candidates) && result.candidates.some(candidate => {
    const parts = object(object(candidate).content).parts;
    return Array.isArray(parts) && parts.some(part => object(part).thought === true);
  })) return true;
  return Array.isArray(result.choices) && result.choices.some(choice => {
    const item = object(choice);
    return [object(item.message), object(item.delta)].some(message =>
      [message.reasoning_content, message.reasoning, message.thinking, message.reasoning_details].some(nonempty));
  });
}

export function thinkingDisabledMessage(model: string) {
  return `模型 ${model} 不支持或未遵守关闭思考设置，已停止调用且不会自动重试。请改用支持关闭思考的模型。`;
}

export function isThinkingSettingError(detail: string) {
  return /(?:thinking|reasoning|thought).*(?:disabled|none|not supported|unsupported|invalid|required|only|minimum)|(?:invalid|unsupported|minimum).*(?:thinking|reasoning)|only type=enabled/i.test(detail);
}
