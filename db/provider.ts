export type DatabaseProvider = "sqlite" | "postgres";

export function databaseProvider(env: NodeJS.ProcessEnv = process.env): DatabaseProvider {
  const value = env.JIANTI_DATABASE_PROVIDER ?? "sqlite";
  if (value !== "sqlite" && value !== "postgres") throw new Error("JIANTI_DATABASE_PROVIDER 仅支持 sqlite 或 postgres");
  return value;
}

export function assertSqliteProvider() {
  if (databaseProvider() !== "sqlite") throw new Error("PostgreSQL 适配器尚未启用，请使用 sqlite；不能仅修改连接串迁移现有数据");
  if (process.env.DATABASE_URL?.startsWith("postgres")) throw new Error("当前使用 SQLite，请勿提供 PostgreSQL DATABASE_URL；需先完成 PostgreSQL 数据迁移");
}
