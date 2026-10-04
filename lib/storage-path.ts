import path from "node:path";

export function resolveFileStorageKey(directory: string, key: string) {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("非法文件存储路径");
  }
  const root = path.resolve(directory, "files");
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("文件路径越界");
  return resolved;
}
