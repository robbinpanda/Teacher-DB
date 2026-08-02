import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "../db";

function storageRoot() {
  return path.join(dataDirectory(), "files");
}

export function resolveStorageKey(key: string) {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("非法文件存储路径");
  }
  const root = storageRoot();
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("文件路径越界");
  return resolved;
}

export async function putFile(key: string, bytes: ArrayBuffer | Uint8Array) {
  const destination = resolveStorageKey(key);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return destination;
}

export async function getFile(key: string) {
  return readFile(resolveStorageKey(key));
}

export function contentTypeForKey(key: string) {
  const extension = path.extname(key).toLowerCase();
  return ({
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".json": "application/json",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}
