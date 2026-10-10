import { lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ModelTraceContent, ModelTraceDetail, ModelTraceSummary } from "./model-trace-types";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILE = /^(manifest\.json|result\.json|validation\.json|output\.txt|thinking\.txt|events\.ndjson|(?:request|response)-[1-9]\d{0,3}\.(?:json|raw))$/;
const CHUNK_BYTES = 64 * 1024;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue { return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {}; }
function string(value: unknown) { return typeof value === "string" ? value : undefined; }
async function regularFile(file: string) { return (await lstat(file).catch(() => null))?.isFile() === true; }
async function json(file: string) {
  if (!await regularFile(file)) return undefined;
  try { return JSON.parse(await readFile(file, "utf8")) as unknown; }
  catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function days(root: string) {
  try { return (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && DAY.test(entry.name)).map(entry => entry.name).sort().reverse(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function summary(directory: string, id: string, ownerId: string, documentId: string) {
  const manifest = object(await json(path.join(directory, "manifest.json")));
  if (manifest.traceId !== id || manifest.ownerId !== ownerId || manifest.documentId !== documentId || !string(manifest.startedAt)) return null;
  const [resultValue, validationValue] = await Promise.all([json(path.join(directory, "result.json")), json(path.join(directory, "validation.json"))]);
  const result = object(resultValue), validation = object(validationValue);
  const status = result.status === "failed" || validation.status === "failed" ? "failed"
    : validation.status === "complete" || (result.status === "complete" && manifest.purpose !== "page_extraction") ? "complete" : "unfinished";
  const item: ModelTraceSummary = {
    id, startedAt: String(manifest.startedAt), finishedAt: string(validation.at) ?? string(result.finishedAt),
    model: string(manifest.model) ?? "模型记录缺失", provider: string(manifest.provider) ?? "", purpose: string(manifest.purpose) ?? "other",
    attempt: typeof manifest.extractionAttempt === "number" ? manifest.extractionAttempt : undefined,
    status, callStatus: string(result.status), validationStatus: string(validation.status),
    error: string(object(validation.value).error) ?? string(object(result.error).message),
  };
  return { item, result: resultValue ?? null, validation: validationValue ?? null };
}

export async function listDocumentModelTraces(dataRoot: string, ownerId: string, documentId: string, before?: string) {
  const root = path.join(dataRoot, "model-traces");
  const items: ModelTraceSummary[] = [];
  for (const day of await days(root)) {
    const entries = (await readdir(path.join(root, day), { withFileTypes: true })).filter(entry => entry.isDirectory() && ID.test(entry.name));
    for (let index = 0; index < entries.length; index += 16) {
      const batch = await Promise.all(entries.slice(index, index + 16).map(entry => summary(path.join(root, day, entry.name), entry.name, ownerId, documentId)));
      items.push(...batch.flatMap(value => value ? [value.item] : []));
    }
  }
  items.sort((left, right) => `${right.startedAt}|${right.id}`.localeCompare(`${left.startedAt}|${left.id}`));
  const remaining = before ? items.filter(item => `${item.startedAt}|${item.id}` < before) : items;
  const traces = remaining.slice(0, 50);
  return { traces, nextCursor: remaining.length > traces.length ? `${traces.at(-1)!.startedAt}|${traces.at(-1)!.id}` : null };
}

async function locate(dataRoot: string, ownerId: string, documentId: string, traceId: string) {
  if (!ID.test(traceId)) return null;
  const root = path.join(dataRoot, "model-traces");
  for (const day of await days(root)) {
    const directory = path.join(root, day, traceId);
    if (!(await lstat(directory).catch(() => null))?.isDirectory()) continue;
    const found = await summary(directory, traceId, ownerId, documentId);
    if (found) return { directory, ...found };
  }
  return null;
}

export async function getDocumentModelTrace(dataRoot: string, ownerId: string, documentId: string, traceId: string): Promise<ModelTraceDetail | null> {
  const found = await locate(dataRoot, ownerId, documentId, traceId);
  if (!found) return null;
  const names = (await readdir(found.directory, { withFileTypes: true })).filter(entry => entry.isFile() && FILE.test(entry.name)).map(entry => entry.name).sort();
  const files = await Promise.all(names.map(async name => ({ name, bytes: (await lstat(path.join(found.directory, name))).size })));
  return { ...found.item, result: found.result, validation: found.validation, files };
}

export async function readDocumentModelTraceContent(dataRoot: string, ownerId: string, documentId: string, traceId: string, name: string, offset = 0): Promise<ModelTraceContent | null> {
  if (!FILE.test(name) || !Number.isSafeInteger(offset) || offset < 0) return null;
  const found = await locate(dataRoot, ownerId, documentId, traceId);
  if (!found) return null;
  const file = path.join(found.directory, name);
  if (!await regularFile(file)) return null;
  const handle = await open(file, "r");
  try {
    const bytes = (await handle.stat()).size;
    if (offset > bytes) return null;
    const buffer = Buffer.alloc(CHUNK_BYTES + 4);
    const read = await handle.read(buffer, 0, buffer.length, offset);
    // Respect UTF-8 code-point boundaries even when a large log contains Chinese text.
    let start = 0;
    while (start < read.bytesRead && (buffer[start] & 0xc0) === 0x80) start++;
    let end = Math.min(CHUNK_BYTES, read.bytesRead);
    if (offset + end < bytes) while (end > start && (buffer[end] & 0xc0) === 0x80) end--;
    return { text: buffer.subarray(start, end).toString("utf8"), offset: offset + start, nextOffset: offset + end < bytes ? offset + end : null, bytes };
  } finally { await handle.close(); }
}
