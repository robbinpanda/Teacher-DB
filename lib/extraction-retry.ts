export const MAX_EXTRACTION_ATTEMPTS = 8;

export function shouldPauseExtraction(attempt: number) {
  return attempt >= MAX_EXTRACTION_ATTEMPTS;
}

export function effectiveExtractionAttempt(runAttempt: number, jobAttempt: number) {
  return Math.max(runAttempt + 1, jobAttempt);
}

export function retryDelayMs(attempt: number, requestedMs?: number, random = Math.random()) {
  if (requestedMs && requestedMs > 0) return Math.min(requestedMs, 30 * 60_000);
  const steps = [5, 15, 30, 60, 120, 300, 600, 900];
  const seconds = steps[Math.min(Math.max(attempt - 1, 0), steps.length - 1)];
  return seconds * 1000 + Math.floor(random * Math.min(5000, seconds * 200));
}
