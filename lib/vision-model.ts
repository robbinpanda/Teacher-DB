import { resolveModelProfile } from "./model-profiles";
import {
  buildVisionHttpRequest,
  extractVisionResponseText,
  extractVisionStreamEvent,
  MODEL_PROTOCOL_LABELS,
} from "./model-protocols";
import { getSqlite } from "../db";
import { extractModelTokenUsage, recordModelUsage } from "./model-usage";

type VisionCall = {
  ownerId: string;
  profileId?: string;
  system: string;
  text: string;
  image?: string;
  images?: Array<{ page: number; dataUrl: string }>;
  jsonMode?: boolean;
  purpose?: "page_extraction" | "question_reextract" | "answer_import" | "connection_test" | "other";
  documentId?: string;
  pageNumber?: number;
  pageCount?: number;
};

export const VISION_STREAM_IDLE_TIMEOUT_MS = 90_000;

type VisionStreamHandlers = {
  onTextDelta: (delta: string) => void | Promise<void>;
  onActivity?: (activity: { kind: "text" | "thinking"; delta: string }) => void | Promise<void>;
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

function compatibilityBody(body: Record<string, unknown>) {
  const fallback = structuredClone(body);
  delete fallback.temperature;
  delete fallback.response_format;
  delete fallback.text;
  return fallback;
}

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
    let response = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (response.status === 400 && input.jsonMode) {
      const firstDetail = await response.text();
      response = await fetch(request.endpoint, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(compatibilityBody(request.body as Record<string, unknown>)),
        signal: controller.signal,
      });
      if (!response.ok && /invalid thinking|only type=enabled|thinking mode.*required/i.test(firstDetail)) {
        throw new ModelCallError(
          `模型 ${profile.displayName} 强制开启思考模式，与本项目固定 reasoning_effort=none 不兼容。`,
          "thinking_mode_incompatible",
          false,
          response.status,
        );
      }
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      if (/invalid thinking|only type=enabled|thinking mode.*required/i.test(detail)) {
        throw new ModelCallError(
          `模型 ${profile.displayName} 强制开启思考模式，与本项目固定 reasoning_effort=none 不兼容。请改用支持无推理模式的多模态模型。`,
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
    if (!content) throw new Error(`模型 ${profile.displayName} 没有返回可解析内容`);
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
    return { content, profile, usage };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelCallError(`模型调用超过 ${Math.round(profile.timeoutMs / 1000)} 秒，已安全中止`, "timeout", true);
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
 * Streams one whole-document model call. The timeout is idle-based: visible output or
 * provider reasoning deltas reset it, so long active calls are never killed at 90 seconds.
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
      stream: true,
    });
    let response = await fetch(request.endpoint, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    if (response.status === 400) {
      const firstDetail = await response.text();
      response = await fetch(request.endpoint, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(compatibilityBody(request.body as Record<string, unknown>)),
        signal: controller.signal,
      });
      if (!response.ok && /invalid thinking|only type=enabled|thinking mode.*required/i.test(firstDetail)) {
        throw new ModelCallError(
          `模型 ${profile.displayName} 强制开启思考模式，与本项目固定 reasoning_effort=none 不兼容。`,
          "thinking_mode_incompatible",
          false,
          response.status,
        );
      }
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
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
    let usagePayload: unknown;
    let receivedProviderEvent = false;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const batch = sseMessages(buffer);
      buffer = batch.rest;
      for (const data of batch.messages) {
        const event = extractVisionStreamEvent(request.protocol, data);
        if (event.error) throw new ModelCallError(event.error, "provider_stream_error", true);
        if (event.textDelta) {
          receivedProviderEvent = true;
          resetIdleTimer();
          content += event.textDelta;
          await handlers.onActivity?.({ kind: "text", delta: event.textDelta });
          await handlers.onTextDelta(event.textDelta);
        }
        if (event.thinkingDelta) {
          receivedProviderEvent = true;
          resetIdleTimer();
          await handlers.onActivity?.({ kind: "thinking", delta: event.thinkingDelta });
        }
        if (event.usagePayload) usagePayload = event.usagePayload;
      }
      if (done) break;
    }

    // A few compatible gateways ignore stream=true and return one regular JSON response.
    if (!receivedProviderEvent && buffer.trim()) {
      const result = JSON.parse(buffer) as unknown;
      const fallbackText = extractVisionResponseText(request.protocol, result);
      if (fallbackText) {
        resetIdleTimer();
        content += fallbackText;
        await handlers.onActivity?.({ kind: "text", delta: fallbackText });
        await handlers.onTextDelta(fallbackText);
      }
      usagePayload = result;
    }
    if (!content) throw new ModelCallError(`模型 ${profile.displayName} 没有返回可解析内容`, "empty_stream", true);
    const usage = extractModelTokenUsage(request.protocol, usagePayload);
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
    return { content, profile, usage };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (idleTimedOut) {
        throw new ModelCallError("模型连续 90 秒没有输出文字或思考活动，已进入退避重试", "stream_idle_timeout", true);
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
  }
}
