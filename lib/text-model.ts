import "server-only";
import { compatibilityBody } from "./model-compatibility";

import { dataDirectory, getSqlite } from "../db";
import { resolveModelProfile } from "./model-profiles";
import { buildVisionHttpRequest, extractVisionResponseText, MODEL_PROTOCOL_LABELS } from "./model-protocols";
import { extractModelTokenUsage, recordModelUsage } from "./model-usage";
import { ModelCallTrace } from "./model-call-trace";
import { hasModelThinking, isThinkingSettingError, thinkingDisabledMessage } from "./model-thinking";
import { ModelCallError } from "./vision-model";
import { textModelTimeout } from "./variation-retry";

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
  timeoutMs?: number;
  minimumTimeoutMs?: number;
  beforeRequest?: () => void | Promise<void>;
}) {
  const profile = await resolveModelProfile(input.ownerId, input.profileId);
  const controller = new AbortController();
  const timeoutMs = textModelTimeout(profile.timeoutMs, input.timeoutMs, input.minimumTimeoutMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let trace: ModelCallTrace | undefined;
  let failure: unknown;
  try {
    const request = buildVisionHttpRequest({
      service: profile.service,
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
    trace = new ModelCallTrace(dataDirectory(), { ownerId: input.ownerId, profileId: profile.id,
      provider: profile.provider, model: profile.model, purpose: input.purpose, documentId: input.documentId });
    await input.beforeRequest?.();
    let response = await trace.fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (response.status === 400 && input.jsonMode) {
      const detail = await response.text();
      if (isThinkingSettingError(detail)) throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false, 400);
      const fallback = compatibilityBody(request.body);
      await input.beforeRequest?.();
      response = await trace.fetch(request.endpoint, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(fallback),
        signal: controller.signal,
      });
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      if (isThinkingSettingError(detail)) throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false, response.status);
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = retryAfter === null ? undefined : Number.isFinite(Number(retryAfter)) ? Math.max(0, Number(retryAfter) * 1000) : Math.max(0, Date.parse(retryAfter) - Date.now());
      throw new ModelCallError(`模型 ${profile.displayName} 通过 ${MODEL_PROTOCOL_LABELS[request.protocol]} 返回 HTTP ${response.status}：${detail}`,
        "http_error", [408, 429, 500, 502, 503, 504].includes(response.status), response.status, retryAfterMs);
    }
    const result = await response.json() as unknown;
    const content = extractVisionResponseText(request.protocol, result);
    if (content) trace.output("text", content);
    const usage = extractModelTokenUsage(request.protocol, result);
    if (usage.inputTokens || usage.outputTokens || usage.cachedInputTokens || usage.cachedOutputTokens) {
      recordModelUsage(getSqlite(), profile, usage, {
        purpose: input.purpose,
        documentId: input.documentId,
        pageCount: 1,
      }, new Date().toISOString());
    }
    if (hasModelThinking(result)) throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false);
    if (!content) throw new Error(`模型 ${profile.displayName} 没有返回可解析内容`);
    return { content, profile, usage, traceId: trace.id };
  } catch (error) {
    failure = error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelCallError(`模型调用超过 ${Math.round(timeoutMs / 1000)} 秒，已安全中止`, "timeout", true, 504);
    }
    if (error instanceof TypeError && /fetch failed|terminated/i.test(error.message)) throw new ModelCallError("模型连接中断，请稍后重试", "network_error", true, 502);
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    trace?.finish(failure === undefined ? "complete" : "failed", failure);
  }
}
