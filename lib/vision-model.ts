import { resolveModelProfile } from "./model-profiles";
import { buildVisionHttpRequest, extractVisionResponseText, MODEL_PROTOCOL_LABELS } from "./model-protocols";

type VisionCall = {
  ownerId: string;
  profileId?: string;
  system: string;
  text: string;
  image?: string;
  images?: Array<{ page: number; dataUrl: string }>;
  jsonMode?: boolean;
};

export async function callVisionModel(input: VisionCall) {
  const profile = await resolveModelProfile(input.ownerId, input.profileId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), profile.timeoutMs);
  try {
    const images = input.images?.length
      ? input.images
      : input.image
        ? [{ page: 1, dataUrl: input.image }]
        : [];
    if (!images.length) throw new Error("模型调用缺少页面图像");
    const request = buildVisionHttpRequest({
      protocol: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
      system: input.system,
      text: input.text,
      images,
      jsonMode: input.jsonMode,
    });
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      if (/invalid thinking|only type=enabled|thinking mode.*required/i.test(detail)) {
        throw new Error(`模型 ${profile.displayName} 强制开启思考模式，与本项目固定 reasoning_effort=none 不兼容。请改用支持无推理模式的多模态模型。`);
      }
      throw new Error(`模型 ${profile.displayName} 通过 ${MODEL_PROTOCOL_LABELS[request.protocol]} 返回 HTTP ${response.status}：${detail}`);
    }
    const result = await response.json() as unknown;
    const content = extractVisionResponseText(request.protocol, result);
    if (!content) throw new Error(`模型 ${profile.displayName} 没有返回可解析内容`);
    return { content, profile };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`模型调用超过 ${Math.round(profile.timeoutMs / 1000)} 秒，已安全中止`);
    }
    if (error instanceof TypeError) {
      const cause = "cause" in error && error.cause instanceof Error ? `；${error.cause.message}` : "";
      throw new Error(`无法连接模型 ${profile.displayName}（${MODEL_PROTOCOL_LABELS[profile.provider]}）：${error.message}${cause}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
