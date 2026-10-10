import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";

export function loadEnvironment(root, mode = process.env.NODE_ENV ?? "production") {
  for (const name of [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"]) {
    const file = path.join(root, name);
    if (existsSync(file)) loadEnvFile(file);
  }
}
