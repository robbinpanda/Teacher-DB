import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export function safeLogValue(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value instanceof Error) return safeLogValue({ name: value.name, message: value.message, stack: value.stack, code: value.code }, depth + 1);
  if (typeof value === 'string') return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|authorization|token|secret|password)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/data:image\/[^\s"']+/g, '[image omitted]').slice(0, 3000);
  if (Array.isArray(value)) return value.slice(0, 30).map(item => safeLogValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) =>
    [key, /authorization|cookie|api.?key|token|secret|password|body|headers/i.test(key) ? '[redacted]' : safeLogValue(item, depth + 1)]));
  return value;
}

export function createRuntimeLogger(directory, role, maxBytes = 5 * 1024 * 1024) {
  const file = path.join(directory, `${role.replace(/[^a-z0-9-]/gi, '_')}.ndjson`);
  return (event, details = {}) => {
    try {
      mkdirSync(directory, { recursive: true });
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) >= maxBytes) {
        try { unlinkSync(`${file}.3`); } catch {}
        for (let index = 2; index >= 1; index--) {
          try { renameSync(`${file}.${index}`, `${file}.${index + 1}`); } catch {}
        }
        renameSync(file, `${file}.1`);
      }
      appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), role, pid: process.pid,
        instanceId: process.env.JIANTI_INSTANCE_ID ?? null, event, details: safeLogValue(details) }) + '\n', { mode: 0o600 });
    } catch {
      // A full disk or unavailable log directory must not crash the application.
    }
  };
}

let writer;
export function runtimeLog(event, details = {}) {
  writer ??= createRuntimeLogger(process.env.JIANTI_RUNTIME_LOG_DIR ?? path.join(process.env.JIANTI_DATA_DIR ?? '.runtime', 'logs'),
    process.env.JIANTI_PROCESS_ROLE ?? 'process');
  writer(event, details);
}

export function installRuntimeMonitor() {
  const marker = Symbol.for('jianti.runtime.monitor');
  if (globalThis[marker]) return;
  globalThis[marker] = true;
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  let cpu = process.cpuUsage(), sampledAt = performance.now();
  const sample = () => {
    const elapsed = performance.now() - sampledAt;
    const usage = process.cpuUsage(cpu);
    runtimeLog('process_sample', { uptimeSeconds: Math.round(process.uptime()), ...process.memoryUsage(),
      cpuPercent: Math.round((usage.user + usage.system) / (elapsed * 10)),
      eventLoopMaxMs: Math.round(lag.max / 1e6), hostFreeBytes: os.freemem(), hostTotalBytes: os.totalmem() });
    cpu = process.cpuUsage(); sampledAt = performance.now(); lag.reset();
  };
  runtimeLog('process_start', { node: process.version });
  sample();
  setInterval(sample, 15000).unref();
  process.on('uncaughtExceptionMonitor', (error, origin) => runtimeLog('fatal_error', { origin, error }));
  process.on('warning', error => runtimeLog('process_warning', { error }));
  process.on('exit', code => runtimeLog('process_exit', { code, ...process.memoryUsage() }));
}
