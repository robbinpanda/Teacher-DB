// Retry only optional formatting/sampling fields. Output budgets and reasoning
// constraints are deliberate limits and must survive provider compatibility retries.
export function compatibilityBody(body: Record<string, unknown>) {
  const fallback = structuredClone(body);
  delete fallback.temperature;
  delete fallback.response_format;
  delete fallback.text;
  return fallback;
}
