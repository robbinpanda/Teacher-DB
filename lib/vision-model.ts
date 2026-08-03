import { chatCompletionsEndpoint, resolveModelProfile } from "./model-profiles";

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
    const userContent: Array<Record<string, unknown>> = [{ type: "text", text: input.text }];
    for (const image of images) {
      userContent.push({ type: "text", text: `下面是原试卷第 ${image.page} 页：` });
      userContent.push({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } });
    }
    const body: Record<string, unknown> = {
      model: profile.model,
      reasoning_effort: "none",
      temperature: 0,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: userContent },
      ],
    };
    if (input.jsonMode) body.response_format = { type: "json_object" };
    const response = await fetch(chatCompletionsEndpoint(profile.baseUrl), {
      method: "POST",
      headers: { authorization: "Bearer " + profile.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      if (/invalid thinking|only type=enabled|thinking mode.*required/i.test(detail)) {
        throw new Error(`模型 ${profile.displayName} 强制开启思考模式，与本项目固定 reasoning_effort=none 不兼容。请改用支持无推理模式的多模态模型。`);
      }
      throw new Error(`模型 ${profile.displayName} 返回 HTTP ${response.status}：${detail}`);
    }
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error(`模型 ${profile.displayName} 没有返回可解析内容`);
    return { content, profile };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`模型调用超过 ${Math.round(profile.timeoutMs / 1000)} 秒，已安全中止`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
