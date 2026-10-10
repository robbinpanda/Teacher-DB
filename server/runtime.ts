import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";

export async function startHeartbeat(role: "api" | "worker") {
  await ensureDatabase();
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const beat = () => {
    const now = new Date();
    getSqlite().prepare(`INSERT INTO runtime_processes (id, role, pid, started_at, heartbeat_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at, expires_at=excluded.expires_at`)
      .run(id, role, process.pid, startedAt, now.toISOString(), new Date(now.getTime() + 15000).toISOString());
  };
  beat();
  const timer = setInterval(() => {
    try { beat(); } catch (error) { console.error(`[${role}] heartbeat failed`, error); }
  }, 5000);
  timer.unref();
  return () => {
    clearInterval(timer);
    getSqlite().prepare("DELETE FROM runtime_processes WHERE id=?").run(id);
  };
}
