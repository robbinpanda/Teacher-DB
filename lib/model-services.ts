import type { ModelProtocol } from "./model-protocols";

export const MODEL_SERVICES = ["opencode", "opencode-go", "openrouter", "custom"] as const;
export type ModelService = typeof MODEL_SERVICES[number];
export const MODEL_SERVICE_LABELS: Record<ModelService, string> = {
  opencode: "OpenCode 普通付费", "opencode-go": "OpenCode Go 套餐", openrouter: "OpenRouter", custom: "自定义",
};

// Official endpoint tables checked 2026-10-13. Keep the requested four choices per service.
// https://opencode.ai/v2/docs/console/models/ and https://opencode.ai/v2/docs/console/go/
type PresetModel = { id: string; label: string; protocol: ModelProtocol };
export const OPENCODE_MODELS: readonly PresetModel[] = [
  { id: "gpt-6-luna", label: "GPT 6 Luna", protocol: "openai-responses" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", protocol: "anthropic-messages" },
  { id: "mimo-v2.6-flash-free", label: "MiMo 2.6 Flash（Free）", protocol: "openai-chat-completions" },
  { id: "deepseek-v4.1-flash", label: "DeepSeek 4.1 Flash", protocol: "openai-chat-completions" },
];
// Console only documents the Free ID; Go uses a distinct subscription ID.
export const OPENCODE_GO_MODELS: readonly PresetModel[] = OPENCODE_MODELS.map(model =>
  model.id === "mimo-v2.6-flash-free"
    ? { ...model, id: "mimo-v2.6-flash", label: "MiMo 2.6 Flash" }
    : model);

export function isOpenCodeService(service: string): service is "opencode" | "opencode-go" {
  return service === "opencode" || service === "opencode-go";
}

export function normalizeModelService(value?: string | null, baseUrl = ""): ModelService {
  if (value != null) {
    if ((MODEL_SERVICES as readonly string[]).includes(value)) return value as ModelService;
    throw new Error("模型服务只能为 OpenCode 普通付费、OpenCode Go 套餐、OpenRouter 或自定义");
  }
  // Recognize existing profiles without migrating/changing their URLs.
  try {
    const url = new URL(baseUrl);
    if (url.origin === "https://openrouter.ai" && /^\/api\/v1(?:\/|$)/.test(url.pathname)) return "openrouter";
    if (url.origin === "https://opencode.ai" && /^\/inference\/go\/v1(?:\/|$)/.test(url.pathname)) return "opencode-go";
    if (url.origin === "https://opencode.ai" && /^\/inference\/(?:v1|openai\/v1|anthropic\/v1|google\/v1beta)(?:\/|$)/.test(url.pathname)) return "opencode";
  } catch { /* An empty URL is expected for a new custom form. */ }
  return "custom";
}

export function builtInModelConnection(service: ModelService, modelValue: string) {
  if (service === "custom") throw new Error("自定义模型需提供接口协议和 API Base URL");
  const model = modelValue.trim().replace(service === "opencode-go" ? /^opencode-go\// : service === "opencode" ? /^opencode\// : /^openrouter\//, "");
  if (!model) throw new Error("请填写模型名称");
  if (service === "openrouter") return { model, provider: "openai-chat-completions" as ModelProtocol, baseUrl: "https://openrouter.ai/api/v1" };
  const entry = (service === "opencode-go" ? OPENCODE_GO_MODELS : OPENCODE_MODELS).find(item => item.id === model);
  if (!entry) throw new Error(`该 ${MODEL_SERVICE_LABELS[service]} 模型尚未适配，请使用对应服务的官方模型 ID；新模型或工作区自接提供商可选择自定义模型并填写官方接口地址及协议`);
  if (service === "opencode-go") return { model, provider: entry.protocol, baseUrl: "https://opencode.ai/inference/go/v1" };
  const family = entry.protocol === "anthropic-messages" ? "anthropic/v1"
    : entry.protocol === "google-generate-content" ? "google/v1beta" : "openai/v1";
  return { model, provider: entry.protocol, baseUrl: `https://opencode.ai/inference/${family}` };
}

export function isOpenCodeEndpoint(value: string, service?: "opencode" | "opencode-go") {
  const url = new URL(value);
  const detected = normalizeModelService(null, value);
  return url.origin === "https://opencode.ai" && isOpenCodeService(detected)
    && (!service || detected === service) && !url.username && !url.password;
}
