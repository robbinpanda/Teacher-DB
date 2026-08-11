export const EXTRACTION_CIRCUIT_FAILURE_THRESHOLD = 3;

export function recordExtractionFailure(currentStreak: unknown, threshold = EXTRACTION_CIRCUIT_FAILURE_THRESHOLD) {
  const parsed = Number(currentStreak);
  const failureStreak = Math.max(0, Number.isFinite(parsed) ? Math.trunc(parsed) : 0) + 1;
  return { failureStreak, shouldPause: failureStreak >= Math.max(1, Math.trunc(threshold)) };
}

export function resetExtractionFailureStreak() {
  return 0;
}
