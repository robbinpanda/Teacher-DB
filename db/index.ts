import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

type AppDatabase = ReturnType<typeof createDrizzle>;

declare global {
  var __SHITI_SQLITE__: Database.Database | undefined;
  var __SHITI_DRIZZLE__: AppDatabase | undefined;
}

export function dataDirectory() {
  const configured = process.env.SHITI_DATA_DIR;
  if (configured) return path.normalize(configured);
  return path.join(/* turbopackIgnore: true */ process.cwd(), "data");
}

export function getSqlite() {
  if (!globalThis.__SHITI_SQLITE__) {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true });
    const databasePath = path.join(directory, "teacher-question-bank.sqlite3");
    const sqlite = new Database(databasePath, { timeout: 5000 });
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("PRAGMA busy_timeout = 5000");
    sqlite.exec("PRAGMA synchronous = NORMAL");
    globalThis.__SHITI_SQLITE__ = sqlite;
  }
  return globalThis.__SHITI_SQLITE__;
}

function query(sql: string, params: unknown[], method: "run" | "all" | "values" | "get") {
  const statement = getSqlite().prepare(sql);
  if (method === "run") {
    const result = statement.run(...params);
    return Promise.resolve({ rows: [], changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid });
  }
  statement.raw(true);
  if (method === "get") return Promise.resolve({ rows: statement.get(...params) as unknown as never[] });
  return Promise.resolve({ rows: statement.all(...params) as unknown[][] });
}

function batchQuery(batch: Array<{ sql: string; params: unknown[]; method: "run" | "all" | "values" | "get" }>) {
  const sqlite = getSqlite();
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const results = batch.map(({ sql, params, method }) => {
      const statement = sqlite.prepare(sql);
      if (method === "run") {
        const result = statement.run(...params);
        return { rows: [], changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
      }
      statement.raw(true);
      if (method === "get") return { rows: statement.get(...params) as unknown as never[] };
      return { rows: statement.all(...params) as unknown[][] };
    });
    sqlite.exec("COMMIT");
    return Promise.resolve(results);
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

function createDrizzle() {
  return drizzle(query, batchQuery, { schema });
}

export function getDb() {
  globalThis.__SHITI_DRIZZLE__ ??= createDrizzle();
  return globalThis.__SHITI_DRIZZLE__;
}

export function sqliteTransaction<T>(action: (sqlite: Database.Database) => T) {
  const sqlite = getSqlite();
  return sqlite.transaction(() => action(sqlite)).immediate();
}
