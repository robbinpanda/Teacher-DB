type RuntimeEvent = "start" | "sample" | "pagehide" | "error" | "unhandled_rejection" | "pdf_start" | "pdf_end" | "pdf_error";
let activePdfs = 0;
let sessionId: string | undefined;
let inFlight = false;
export function changeActivePdfCount(delta: number) { activePdfs = Math.max(0, activePdfs + delta); }

export function reportBrowserRuntime(event: RuntimeEvent) {
  if (typeof window === "undefined" || (inFlight && event === "sample")) return;
  sessionId ??= crypto.randomUUID();
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const payload = { event, sessionId, activePdfs, visibility: document.visibilityState,
    heapUsed: memory?.usedJSHeapSize, heapTotal: memory?.totalJSHeapSize, heapLimit: memory?.jsHeapSizeLimit,
    domNodes: document.getElementsByTagName("*").length, canvases: document.getElementsByTagName("canvas").length };
  // Only numeric diagnostics; never send document contents, filenames or credentials.
  inFlight = true;
  void fetch("/api/runtime-events", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload), keepalive: true, signal: AbortSignal.timeout(5000) })
    .catch(() => undefined).finally(() => { inFlight = false; });
}
