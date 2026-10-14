import { getSqlite } from "../db";
import { ensureDatabase } from "../db/bootstrap";
import { installRuntimeMonitor, runtimeLog } from "../lib/runtime-log.mjs";

export async function startHeartbeat(role: "api" | "worker") {
  installRuntimeMonitor();
  await ensureDatabase();
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let lastSample = 0;
  const beat = () => {
    const now = new Date();
    getSqlite().prepare(`INSERT INTO runtime_processes (id, role, pid, started_at, heartbeat_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at, expires_at=excluded.expires_at`)
      .run(id, role, process.pid, startedAt, now.toISOString(), new Date(now.getTime() + 15000).toISOString());
    if (role === "worker" && now.getTime() - lastSample >= 15000) {
      lastSample = now.getTime();
      runtimeLog("queue_sample", {
        jobs: getSqlite().prepare("SELECT status, COUNT(*) AS count FROM document_jobs GROUP BY status").all(),
        settings: getSqlite().prepare("SELECT extraction_concurrency AS concurrency, extraction_paused AS paused FROM app_settings").all(),
      });
    }
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
