import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvironment } from "./env.mjs";
import { preparePython } from "./python-runtime.mjs";
import { buildFingerprint } from "./build-fingerprint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const mode = args.has("--dev") ? "dev" : "start";
loadEnvironment(root, mode === "dev" ? "development" : "production");
const webPort = Number(option("web-port", process.env.JIANTI_WEB_PORT ?? "3050"));
const apiPort = Number(option("api-port", process.env.JIANTI_API_PORT ?? "3051"));
const processorPort = Number(option("processor-port", process.env.JIANTI_PROCESSOR_PORT ?? "3052"));
if (![webPort, apiPort, processorPort].every(port => Number.isInteger(port) && port >= 1 && port <= 65535)) throw new Error("服务端口必须是 1–65535 的整数");
process.env.APP_BASE_URL ||= `http://127.0.0.1:${webPort}`;
const instanceId = crypto.randomUUID();
const statePath = path.join(root, ".runtime", `local-${webPort}.json`);
const children = [];
let stopping = false;
const restarts = new Map();

function start(label, commandArgs, extraEnv = {}, executable = process.execPath) {
  const child = spawn(executable, commandArgs, {
    cwd: root, env: { ...process.env, NODE_ENV: mode === "dev" ? "development" : "production", JIANTI_INSTANCE_ID: instanceId, JIANTI_API_PORT: String(apiPort),
      JIANTI_API_URL: `http://127.0.0.1:${apiPort}`, ...extraEnv }, stdio: "inherit", windowsHide: true,
  });
  children.push(child);
  child.once("error", error => { console.error(`[local] ${label}: ${error.message}`); void stop(1); });
  child.once("exit", code => {
    if (stopping) return;
    if (label === "api" || label === "worker" || label === "processor") {
      const previous = restarts.get(label);
      const count = previous && Date.now() - previous.at < 60000 ? previous.count + 1 : 1;
      restarts.set(label, { count, at: Date.now() });
      if (count <= 5) {
        const delay = Math.min(8000, 500 * 2 ** (count - 1));
        console.error(`[local] ${label} exited (${code}); restarting in ${delay}ms`);
        setTimeout(() => { if (!stopping) start(label, commandArgs, extraEnv, executable); }, delay);
        return;
      }
    }
    console.error(`[local] ${label} exited (${code})`);
    void stop(code || 1);
  });
  return child;
}

async function waitReady(url, expectedInstance, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        if (expectedInstance && (await response.json()).instanceId !== expectedInstance) throw new Error("port_owned_by_another_instance");
        return;
      }
    } catch (error) {
      if (error.message === "port_owned_by_another_instance") throw new Error("服务端口已被另一实例占用");
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`服务未就绪：${url}`);
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  try {
    const current = JSON.parse(await readFile(statePath, "utf8"));
    if (current.instanceId === instanceId) await unlink(statePath);
  } catch {}
  await Promise.all(children.reverse().map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      // Only process trees created by this supervisor are targeted.
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await once(killer, "exit");
    } else {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }));
  process.exit(exitCode);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  let existing;
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (state.project === root) {
      const response = await fetch(`http://127.0.0.1:${state.apiPort}/api/ready`, { signal: AbortSignal.timeout(1500) });
      const ready = await response.json();
      if (ready.instanceId === state.instanceId) existing = state;
    }
  } catch {}
  if (existing) {
    console.log(`[local] already running http://localhost:${webPort}`);
    if (args.has("--open") && process.platform === "win32") spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Start-Process 'http://localhost:${webPort}'`], { windowsHide: true, stdio: "ignore" });
    process.exit(0);
  }
  if (args.has("--build")) {
    const fingerprint = await buildFingerprint(root);
    const stamp = path.join(root, ".next", "local-build.sha256");
    const previous = await readFile(stamp, "utf8").catch(() => "");
    const built = await readFile(path.join(root, ".next", "BUILD_ID"), "utf8").catch(() => "");
    if (fingerprint !== previous || !built) {
      console.log("[local] building production frontend");
      const build = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], { cwd: root, stdio: "inherit", env: process.env, windowsHide: true });
      const [code] = await once(build, "exit");
      if (code !== 0) throw new Error("前端构建失败");
      await writeFile(stamp, fingerprint);
    } else console.log("[local] using existing frontend build");
  }
  if (args.has("--with-python") || process.env.JIANTI_WITH_PYTHON === "1") {
    const python = await preparePython(root);
    process.env.JIANTI_PROCESSOR_TOKEN ||= crypto.randomUUID() + crypto.randomUUID();
    process.env.JIANTI_DOCUMENT_PROCESSOR_URL = `http://127.0.0.1:${processorPort}`;
    start("processor", ["-m", "uvicorn", "processor.main:app", "--host", "127.0.0.1", "--port", String(processorPort)], {}, python);
    await waitReady(`http://127.0.0.1:${processorPort}/ready`, instanceId);
  }
  start("api", ["--import", "./server/register.mjs", "--import", "tsx", "server/main.ts"]);
  await waitReady(`http://127.0.0.1:${apiPort}/api/ready`, instanceId);
  start("worker", ["--import", "./server/register.mjs", "--import", "tsx", "server/worker.ts"]);
  await waitReady(`http://127.0.0.1:${apiPort}/api/ready?dependencies=1`, instanceId);
  start("web", ["node_modules/next/dist/bin/next", mode, "-H", process.env.JIANTI_WEB_HOST ?? "127.0.0.1", "-p", String(webPort)]);
  await waitReady(`http://127.0.0.1:${webPort}/api/ready`);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ project: root, supervisorPid: process.pid, instanceId, webPort, apiPort, startedAt: new Date().toISOString() }, null, 2));
  console.log(`[local] ready http://localhost:${webPort} (NestJS + independent worker${process.env.JIANTI_DOCUMENT_PROCESSOR_URL ? " + FastAPI PDF" : ""})`);
  if (args.has("--open") && process.platform === "win32") {
    spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Start-Process 'http://localhost:${webPort}'`], { windowsHide: true, stdio: "ignore" });
  }
} catch (error) {
  console.error(`[local] ${error.message}`);
  await stop(1);
}
