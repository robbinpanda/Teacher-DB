import { spawn } from "node:child_process";
import { once } from "node:events";

export async function stopIsolatedProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await once(killer, "exit");
  } else child.kill("SIGTERM");
  await exited;
}
