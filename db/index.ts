import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { runtimeEnv } from "../lib/server";

export function getDb() {
  const bindings = runtimeEnv();
  if (!bindings.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(bindings.DB, { schema });
}
