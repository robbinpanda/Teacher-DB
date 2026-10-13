export const BASKET_LIMIT = 200;

export function basketStorageKey(ownerId: string, subject: string, stage: string) {
  return `jianti-question-basket:v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(subject)}:${stage}`;
}

export function readBasketIds(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("本机选题篮数据无法读取，请清空后重新选题"); }
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !id.trim() || id.length > 100)) {
    throw new Error("本机选题篮数据无法读取，请清空后重新选题");
  }
  if (value.length > BASKET_LIMIT) throw new Error(`选题篮最多保存 ${BASKET_LIMIT} 道题`);
  return [...new Set(value as string[])];
}

export function appendBasketItems<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const result = [...current];
  const ids = new Set(current.map(item => item.id));
  for (const item of incoming) if (!ids.has(item.id)) { result.push(item); ids.add(item.id); }
  if (result.length > BASKET_LIMIT) throw new Error(`选题篮最多保存 ${BASKET_LIMIT} 道题，请先完成本次组卷`);
  return result;
}
