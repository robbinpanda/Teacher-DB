// Retry only optional formatting/sampling fields. Output budgets and reasoning
// constraints are deliberate limits and must survive provider compatibility retries.
export function compatibilityBody(body: Record<string, unknown>) {
  const fallback = structuredClone(body);
  delete fallback.temperature;
  delete fallback.response_format;
  delete fallback.text;
  if (fallback.generationConfig && typeof fallback.generationConfig === "object") {
    const config = fallback.generationConfig as Record<string, unknown>;
    delete config.temperature;
    delete config.responseMimeType;
  }
  return fallback;
}
