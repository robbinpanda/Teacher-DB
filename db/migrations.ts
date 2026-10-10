import type Database from "better-sqlite3";

export type Migration = { version: number; name: string; checksum: string; up: (sqlite: Database.Database) => void };

export function runMigrations(sqlite: Database.Database, migrations: Migration[]) {
  // Lock before reading the ledger: simultaneous API/worker startup applies each
  // migration once. Schema changes and the ledger entry commit together.
  return sqlite.transaction(() => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    )`);
    const applied = sqlite.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as Array<{ version: number; checksum: string }>;
    const known = new Map(migrations.map(migration => [migration.version, migration]));
    for (const entry of applied) {
      const migration = known.get(entry.version);
      if (!migration) throw new Error(`数据库版本 ${entry.version} 高于当前程序支持的版本，请升级程序`);
      if (migration.checksum !== entry.checksum) throw new Error(`数据库迁移 ${entry.version} 校验不一致，已停止启动`);
    }
    const versions = new Set(applied.map(entry => entry.version));
    for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
      if (versions.has(migration.version)) continue;
      migration.up(sqlite);
      sqlite.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
        .run(migration.version, migration.name, migration.checksum, new Date().toISOString());
    }
    return migrations.at(-1)?.version ?? 0;
  }).immediate();
}
