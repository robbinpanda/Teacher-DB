import "server-only";

import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "../db";
import { resolveFileStorageKey } from "./storage-path";

export function resolveStorageKey(key: string) {
  return resolveFileStorageKey(dataDirectory(), key);
}

export async function putFile(key: string, bytes: ArrayBuffer | Uint8Array) {
  const destination = resolveStorageKey(key);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  await writeFile(temporary, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { flag: "wx" });
  try {
    await rename(temporary, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    try { await access(destination); }
    catch { throw error; }
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return destination;
}

export async function getFile(key: string) {
  return readFile(resolveStorageKey(key));
}

export async function deleteFile(key: string) {
  try {
    await unlink(resolveStorageKey(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
