import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations.ts";

test("迁移只执行一次，历史数据被保留", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE history (value TEXT); INSERT INTO history VALUES ('saved')");
  let applied = 0;
  const migrations = [{ version: 1, name: "fixture", checksum: "v1", up: db => { applied++; db.exec("ALTER TABLE history ADD COLUMN extra TEXT"); } }];
  runMigrations(sqlite, migrations);
  runMigrations(sqlite, migrations);
  assert.equal(applied, 1);
  assert.equal(sqlite.prepare("SELECT value FROM history").get().value, "saved");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 1);
  sqlite.close();
});

test("失败迁移和版本记录一起回滚，修复后可重试", () => {
  const sqlite = new Database(":memory:");
  const bad = { version: 1, name: "fixture", checksum: "v1", up: db => { db.exec("CREATE TABLE partial (id INTEGER)"); throw new Error("interrupted"); } };
  assert.throws(() => runMigrations(sqlite, [bad]), /interrupted/);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(), undefined);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get(), undefined);
  runMigrations(sqlite, [{ ...bad, up: db => db.exec("CREATE TABLE partial (id INTEGER)") }]);
  assert.equal(sqlite.prepare("SELECT version FROM schema_migrations").get().version, 1);
  sqlite.close();
});

test("校验不匹配和数据库版本过新均阻止启动", () => {
  const sqlite = new Database(":memory:");
  const original = { version: 1, name: "fixture", checksum: "v1", up: () => {} };
  runMigrations(sqlite, [original]);
  assert.throws(() => runMigrations(sqlite, [{ ...original, checksum: "changed" }]), /校验不一致/);
  assert.throws(() => runMigrations(sqlite, []), /高于/);
  sqlite.close();
});
