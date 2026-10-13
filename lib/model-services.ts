import type { ModelProtocol } from "./model-protocols";

export const MODEL_SERVICES = ["opencode", "openrouter", "custom"] as const;
export type ModelService = typeof MODEL_SERVICES[number];
export const MODEL_SERVICE_LABELS: Record<ModelService, string> = {
  opencode: "OpenCode", openrouter: "OpenRouter", custom: "自定义",
};

// Official Console model endpoint table, checked 2026-10-13.
// https://opencode.ai/v2/docs/console/models/ — exact IDs: Qwen models do not all use the same API.
const families: Record<ModelProtocol, string> = {
  "openai-responses": "gpt-6-astra gpt-6-sol gpt-6.1-sol gpt-6-luna gpt-5.6-sol gpt-5.6-terra gpt-5.6-luna gpt-5.5 gpt-5.5-pro gpt-5.4 gpt-5.4-pro gpt-5.4-mini gpt-5.4-nano gpt-5.3-codex gpt-5.3-codex-spark gpt-5.2 gpt-5.2-codex gpt-5.1 gpt-5.1-codex gpt-5.1-codex-max gpt-5.1-codex-mini gpt-5 gpt-5-codex gpt-5-nano grok-4.7 grok-4.6 grok-4.5 grok-build-0.1 muse-spark-1.3 muse-spark-1.2 muse-spark-1.3-contributor-free",
  "anthropic-messages": "claude-fable-5-1 claude-fable-5 claude-opus-5-5 claude-opus-5 claude-opus-4-8 claude-opus-4-7 claude-opus-4-6 claude-opus-4-5 claude-sonnet-5-5 claude-sonnet-5 claude-sonnet-4-6 claude-sonnet-4-5 claude-haiku-5-5 claude-haiku-4-5 qwen3.8-flash qwen3.7-max qwen3.7-plus qwen3.6-plus qwen3.5-plus",
  "google-generate-content": "gemini-3.8-flash gemini-3.7-flash gemini-3.6-flash gemini-3.5-flash gemini-3.5-flash-lite gemini-3.1-pro gemini-3-flash",
  "openai-chat-completions": "qwen3.8-max deepseek-v4.1-flash deepseek-v4-pro deepseek-v4-flash deepseek-v4-flash-vision-exp minimax-m3 minimax-m2.7 minimax-m2.5 glm-5.3-flash glm-5.3 glm-5.2 glm-5.1 glm-5 kimi-k2.5 kimi-k2.6 kimi-k2.7-code kimi-k3 mistral-large-4 big-pickle space-bunny-free cat-jam-free longcat-2.5-preview-free step-5-preview-free exo-free mimo-v2.6-flash-free mimo-v2.5-free ling-3.1-flash-free ling-3.0-flash-fin-free nemotron-3-ultra-free nemotron-3.5-lightning-free",
};
export const OPENCODE_MODELS = Object.entries(families).flatMap(([protocol, ids]) =>
  ids.split(" ").map(id => ({ id, protocol: protocol as ModelProtocol })));

export function normalizeModelService(value?: string | null, baseUrl = ""): ModelService {
  if (value != null) {
    if ((MODEL_SERVICES as readonly string[]).includes(value)) return value as ModelService;
    throw new Error("模型服务只能为 OpenCode、OpenRouter 或自定义");
  }
  // Recognize existing profiles without migrating/changing their URLs.
  try {
    const url = new URL(baseUrl);
    if (url.origin === "https://openrouter.ai" && /^\/api\/v1(?:\/|$)/.test(url.pathname)) return "openrouter";
    if (url.origin === "https://opencode.ai" && /^\/inference\/(?:v1|openai\/v1|anthropic\/v1|google\/v1beta)(?:\/|$)/.test(url.pathname)) return "opencode";
  } catch { /* An empty URL is expected for a new custom form. */ }
  return "custom";
}

export function builtInModelConnection(service: ModelService, modelValue: string) {
  if (service === "custom") throw new Error("自定义模型需提供接口协议和 API Base URL");
  const model = modelValue.trim().replace(service === "opencode" ? /^opencode\// : /^openrouter\//, "");
  if (!model) throw new Error("请填写模型名称");
  if (service === "openrouter") return { model, provider: "openai-chat-completions" as ModelProtocol, baseUrl: "https://openrouter.ai/api/v1" };
  const entry = OPENCODE_MODELS.find(item => item.id === model);
  if (!entry) throw new Error("该 OpenCode 模型尚未适配，请使用官方模型 ID；新模型或工作区自接提供商可选择自定义模型并填写官方接口地址及协议");
  const family = entry.protocol === "anthropic-messages" ? "anthropic/v1"
    : entry.protocol === "google-generate-content" ? "google/v1beta" : "openai/v1";
  return { model, provider: entry.protocol, baseUrl: `https://opencode.ai/inference/${family}` };
}

export function isOpenCodeEndpoint(value: string) {
  const url = new URL(value);
  return url.origin === "https://opencode.ai" && /^\/inference\//.test(url.pathname) && !url.username && !url.password;
}
