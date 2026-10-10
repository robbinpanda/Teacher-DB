import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function buildFingerprint(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true }).catch(() => [])) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (/\.(tsx?|jsx?|mjs|css|json|svg|png|webp)$/.test(entry.name)) files.push(relative);
    }
  }
  for (const directory of ["app", "components", "lib", "db", "server", "public"]) await walk(directory);
  files.push("package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs");
  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isFile() && entry.name.startsWith(".env")) files.push(entry.name);
  const hash = createHash("sha256");
  hash.update(process.version);
  hash.update(process.env.NEXT_PUBLIC_APP_BASE_URL ?? "");
  for (const key of Object.keys(process.env).filter(key => key.startsWith("NEXT_PUBLIC_")).sort()) hash.update(key + "=" + process.env[key]);
  for (const file of files.sort()) { hash.update(file); hash.update(await readFile(path.join(root, file)).catch(() => "")); }
  return hash.digest("hex");
}
