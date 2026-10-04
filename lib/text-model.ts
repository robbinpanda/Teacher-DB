import "server-only";
import { compatibilityBody } from "./model-compatibility";

import { getSqlite } from "../db";
import { resolveModelProfile } from "./model-profiles";
import { buildVisionHttpRequest, extractVisionResponseText, MODEL_PROTOCOL_LABELS } from "./model-protocols";
import { extractModelTokenUsage, recordModelUsage } from "./model-usage";

export async function callTextModel(input: {
  ownerId: string;
  profileId?: string;
  system: string;
  text: string;
  purpose: string;
  documentId?: string;
  jsonMode?: boolean;
  images?: Array<{ page: number; dataUrl: string }>;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  const profile = await resolveModelProfile(input.ownerId, input.profileId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), profile.timeoutMs);
  try {
    const request = buildVisionHttpRequest({
      protocol: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
      system: input.system,
      text: input.text,
      images: input.images ?? [],
      jsonMode: input.jsonMode,
      maxOutputTokens: input.maxOutputTokens,
      temperature: input.temperature,
    });
    let response = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (response.status === 400 && input.jsonMode) {
      await response.body?.cancel();
      const fallback = compatibilityBody(request.body);
      response = await fetch(request.endpoint, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(fallback),
        signal: controller.signal,
      });
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error(`模型 ${profile.displayName} 通过 ${MODEL_PROTOCOL_LABELS[request.protocol]} 返回 HTTP ${response.status}：${detail}`);
    }
    const result = await response.json() as unknown;
    const content = extractVisionResponseText(request.protocol, result);
    if (!content) throw new Error(`模型 ${profile.displayName} 没有返回可解析内容`);
    const usage = extractModelTokenUsage(request.protocol, result);
    if (usage.inputTokens || usage.outputTokens || usage.cachedInputTokens || usage.cachedOutputTokens) {
      recordModelUsage(getSqlite(), profile, usage, {
        purpose: input.purpose,
        documentId: input.documentId,
        pageCount: 1,
      }, new Date().toISOString());
    }
    return { content, profile, usage };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`模型调用超过 ${Math.round(profile.timeoutMs / 1000)} 秒，已安全中止`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
