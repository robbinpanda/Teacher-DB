import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const webPort = Number(process.argv.find(value => value.startsWith("--web-port="))?.split("=")[1] ?? process.env.JIANTI_WEB_PORT ?? 3050);
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) throw new Error("端口无效");
let state;
try { state = JSON.parse(await readFile(path.join(root, ".runtime", `local-${webPort}.json`), "utf8")); }
catch { console.log("[local] No managed local instance is running."); process.exit(0); }
if (path.resolve(state.project) !== root || !Number.isInteger(state.supervisorPid) || state.supervisorPid <= 0) throw new Error("运行记录无效，未停止任何进程");
let ready;
try {
  const response = await fetch(`http://127.0.0.1:${state.apiPort}/api/ready`, { signal: AbortSignal.timeout(3000) });
  ready = await response.json();
} catch { throw new Error("无法核对运行实例，未停止任何进程；请关闭启动窗口或检查服务日志"); }
if (ready.instanceId !== state.instanceId) throw new Error("端口属于其他实例，未停止任何进程");
if (check) { console.log(`[local] Managed instance verified (PID ${state.supervisorPid}).`); process.exit(0); }
if (process.platform === "win32") {
  const child = spawn("taskkill", ["/PID", String(state.supervisorPid), "/T", "/F"], { windowsHide: true, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) process.exitCode = code;
} else process.kill(state.supervisorPid, "SIGTERM");
