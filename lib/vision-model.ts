import { compatibilityBody } from "./model-compatibility";
import { resolveModelProfile } from "./model-profiles";
import {
  buildVisionHttpRequest,
  extractVisionResponseText,
  extractVisionStreamEvent,
  MODEL_PROTOCOL_LABELS,
} from "./model-protocols";
import { dataDirectory, getSqlite } from "../db";
import { extractModelTokenUsage, recordModelUsage } from "./model-usage";
import { ModelCallTrace } from "./model-call-trace";
import { hasModelThinking, isThinkingSettingError, thinkingDisabledMessage } from "./model-thinking";
import { hasRunawayFiller } from "./extraction-stream-guard";

type VisionCall = {
  ownerId: string;
  profileId?: string;
  system: string;
  text: string;
  image?: string;
  images?: Array<{ page: number; dataUrl: string; label?: string }>;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
  onTrace?: (trace: ModelCallTrace) => void;
  purpose?: "page_extraction" | "question_reextract" | "question_review" | "answer_import" | "connection_test" | "other";
  documentId?: string;
  pageNumber?: number;
  pageCount?: number;
  extractionRunId?: string;
  extractionAttempt?: number;
};

export const VISION_STREAM_IDLE_TIMEOUT_MS = 90_000;

type VisionStreamHandlers = {
  onTextDelta: (delta: string) => void | Promise<void>;
  onActivity?: (activity: { kind: "text" | "thinking"; delta: string }) => void | Promise<void>;
  onTrace?: (trace: ModelCallTrace) => void;
};

export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

function retryAfterMs(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function isRetryableProviderError(status: number, detail: string) {
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return /upstream request failed|provider returned error|overload|over capacity|busy|congest|rate.?limit|network|temporar|try again|timeout/i.test(detail);
}


export async function callVisionModel(input: VisionCall) {
  const profile = await resolveModelProfile(input.ownerId, input.profileId);
  const controller = new AbortController();
  const timeoutMs = Math.min(profile.timeoutMs, input.timeoutMs ?? profile.timeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let trace: ModelCallTrace | undefined;
  let failure: unknown;
  try {
    const images = input.images?.length
      ? input.images
      : input.image
        ? [{ page: 1, dataUrl: input.image }]
        : [];
    if (!images.length && input.purpose !== "question_review") throw new Error("模型调用缺少页面图像");
    const request = buildVisionHttpRequest({
      service: profile.service,
      sessionId: input.extractionRunId,
      protocol: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
      system: input.system,
      text: input.text,
      images,
      jsonMode: input.jsonMode,
      maxOutputTokens: input.maxOutputTokens,
    });
    trace = new ModelCallTrace(dataDirectory(), { ownerId: input.ownerId, profileId: profile.id,
      provider: profile.provider, model: profile.model, purpose: input.purpose ?? "other", documentId: input.documentId });
    input.onTrace?.(trace);
    let response = await trace.fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (response.status === 400 && input.jsonMode) {
      const firstDetail = await response.text();
      if (isThinkingSettingError(firstDetail)) {
        throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false, 400);
      }
      response = await trace.fetch(request.endpoint, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(compatibilityBody(request.body as Record<string, unknown>)),
        signal: controller.signal,
      });
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      if (isThinkingSettingError(detail)) {
        throw new ModelCallError(
          thinkingDisabledMessage(profile.displayName),
          "thinking_mode_incompatible",
          false,
          response.status,
        );
      }
      throw new ModelCallError(
        `模型 ${profile.displayName} 通过 ${MODEL_PROTOCOL_LABELS[request.protocol]} 返回 HTTP ${response.status}：${detail}`,
        `provider_http_${response.status}`,
        isRetryableProviderError(response.status, detail),
        response.status,
        retryAfterMs(response),
      );
    }
    const result = await response.json() as unknown;
    const content = extractVisionResponseText(request.protocol, result);
    if (content) trace.output("text", content);
    const usage = extractModelTokenUsage(request.protocol, result);
    if (usage.inputTokens || usage.outputTokens || usage.cachedInputTokens || usage.cachedOutputTokens) {
      try {
        recordModelUsage(getSqlite(), profile, usage, {
          purpose: input.purpose ?? "other",
          documentId: input.documentId,
          pageNumber: input.pageNumber,
          pageCount: input.pageCount,
        }, new Date().toISOString());
      } catch (usageError) {
        console.error("模型 Token 用量记录失败", usageError);
      }
    }
    if (hasModelThinking(result)) throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false);
    if (!content) throw new Error(`模型 ${profile.displayName} 没有返回可解析内容`);
    return { content, profile, usage, traceId: trace.id };
  } catch (error) {
    failure = error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelCallError(`模型调用超过 ${Math.round(timeoutMs / 1000)} 秒，已安全中止`, "timeout", true);
    }
    if (error instanceof TypeError) {
      const cause = "cause" in error && error.cause instanceof Error ? `；${error.cause.message}` : "";
      throw new ModelCallError(
        `无法连接模型 ${profile.displayName}（${MODEL_PROTOCOL_LABELS[profile.provider]}）：${error.message}${cause}`,
        "network_error",
        true,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    trace?.finish(failure === undefined ? "complete" : "failed", failure);
  }
}

function sseMessages(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return {
    rest,
    messages: parts.flatMap((part) => {
      const data = part.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      return data ? [data] : [];
    }),
  };
}

/**
 * Streams one whole-document model call. Only answer text resets the idle timeout.
 * Providers that ignore the disabled-thinking setting are stopped immediately.
 */
export async function callVisionModelStream(input: VisionCall, handlers: VisionStreamHandlers) {
  const profile = await resolveModelProfile(input.ownerId, input.profileId);
  const controller = new AbortController();
  let idleTimedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort();
    }, VISION_STREAM_IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
  };
  resetIdleTimer();
  let trace: ModelCallTrace | undefined;
  let failure: unknown;
  let usagePayload: unknown;
  try {
    const images = input.images?.length
      ? input.images
      : input.image
        ? [{ page: 1, dataUrl: input.image }]
        : [];
    if (!images.length) throw new Error("模型调用缺少页面图像");
    const request = buildVisionHttpRequest({
      service: profile.service,
      sessionId: input.extractionRunId,
      protocol: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
      system: input.system,
      text: input.text,
      images,
      stream: true,
      maxOutputTokens: 32768,
    });
    trace = new ModelCallTrace(dataDirectory(), { ownerId: input.ownerId, profileId: profile.id,
      provider: profile.provider, model: profile.model, purpose: input.purpose ?? "other", documentId: input.documentId,
      extractionRunId: input.extractionRunId, extractionAttempt: input.extractionAttempt });
    handlers.onTrace?.(trace);
    let response = await trace.fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (response.status === 400) {
      const firstDetail = await response.text();
      if (isThinkingSettingError(firstDetail)) {
        throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false, 400);
      }
      response = await trace.fetch(request.endpoint, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(compatibilityBody(request.body as Record<string, unknown>)),
        signal: controller.signal,
      });
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      if (isThinkingSettingError(detail)) {
        throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false, response.status);
      }
      throw new ModelCallError(
        `模型 ${profile.displayName} 通过 ${MODEL_PROTOCOL_LABELS[request.protocol]} 返回 HTTP ${response.status}：${detail}`,
        `provider_http_${response.status}`,
        isRetryableProviderError(response.status, detail),
        response.status,
        retryAfterMs(response),
      );
    }
    if (!response.body) throw new ModelCallError("模型没有返回可读取的流", "empty_stream", true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let receivedProviderEvent = false;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const batch = sseMessages(buffer);
      buffer = batch.rest;
      for (const data of batch.messages) {
        const event = extractVisionStreamEvent(request.protocol, data);
        if (event.usagePayload) usagePayload = event.usagePayload;
        if (event.error) {
          if (isThinkingSettingError(event.error)) throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false);
          throw new ModelCallError(event.error, "provider_stream_error", true);
        }
        if (event.thinkingDelta || event.thinkingPresent || hasModelThinking(event.usagePayload)) {
          if (event.thinkingDelta) trace.output("thinking", event.thinkingDelta);
          throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false);
        }
        if (event.textDelta) {
          receivedProviderEvent = true;
          resetIdleTimer();
          content += event.textDelta;
          trace.output("text", event.textDelta);
          if (hasRunawayFiller(content)) throw new ModelCallError("模型持续重复输出填空线，已中止并保留已完成题目", "repetitive_output", true);
          await handlers.onActivity?.({ kind: "text", delta: event.textDelta });
          await handlers.onTextDelta(event.textDelta);
        }
      }
      if (done) break;
    }

    // A few compatible gateways ignore stream=true and return one regular JSON response.
    if (!receivedProviderEvent && buffer.trim()) {
      const result = JSON.parse(buffer) as unknown;
      usagePayload = result;
      if (hasModelThinking(result)) throw new ModelCallError(thinkingDisabledMessage(profile.displayName), "thinking_mode_incompatible", false);
      const fallbackText = extractVisionResponseText(request.protocol, result);
      if (fallbackText) {
        resetIdleTimer();
        content += fallbackText;
        trace.output("text", fallbackText);
        await handlers.onActivity?.({ kind: "text", delta: fallbackText });
        await handlers.onTextDelta(fallbackText);
      }
    }
    if (!content) throw new ModelCallError(`模型 ${profile.displayName} 没有返回可解析内容`, "empty_stream", true);
    const usage = extractModelTokenUsage(request.protocol, usagePayload);
    return { content, profile, usage, traceId: trace.id };
  } catch (error) {
    failure = error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (idleTimedOut) {
        throw new ModelCallError("模型连续 90 秒没有输出正文，等待从未完成题目继续", "stream_idle_timeout", true);
      }
      throw new ModelCallError("模型流被中止", "stream_aborted", true);
    }
    if (error instanceof TypeError) {
      const cause = "cause" in error && error.cause instanceof Error ? `；${error.cause.message}` : "";
      throw new ModelCallError(
        `无法连接模型 ${profile.displayName}（${MODEL_PROTOCOL_LABELS[profile.provider]}）：${error.message}${cause}`,
        "network_error",
        true,
      );
    }
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    controller.abort();
    // Providers can charge for failed/empty responses too; retain reported usage.
    const usage = extractModelTokenUsage(profile.provider, usagePayload);
    if (usage.inputTokens || usage.outputTokens || usage.cachedInputTokens || usage.cachedOutputTokens) {
      try {
        recordModelUsage(getSqlite(), profile, usage, {
          purpose: input.purpose ?? "other", documentId: input.documentId,
          pageNumber: input.pageNumber, pageCount: input.pageCount,
        }, new Date().toISOString());
      } catch (usageError) { console.error("模型 Token 用量记录失败", usageError); }
    }
    trace?.finish(failure === undefined ? "complete" : "failed", failure);
  }
}
