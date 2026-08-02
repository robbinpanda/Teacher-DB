import { chatCompletionsEndpoint, resolveModelProfile } from "./model-profiles";

type VisionCall = {
  ownerId: string;
  profileId?: string;
  system: string;
  text: string;
  image: string;
  jsonMode?: boolean;
};

export async function callVisionModel(input: VisionCall) {
  const profile = await resolveModelProfile(input.ownerId, input.profileId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), profile.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: profile.model,
      reasoning_effort: "none",
      temperature: 0,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: [
          { type: "text", text: input.text },
          { type: "image_url", image_url: { url: input.image, detail: "high" } },
        ] },
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
