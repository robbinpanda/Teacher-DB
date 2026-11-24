import { mkdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Database from "better-sqlite3";

const WINDOW_MS = 60_000;
const DEFAULT_RPM = 50;
function configuredRpm() {
  const rpm = Number(process.env.JIANTI_MODEL_RPM);
  return Number.isSafeInteger(rpm) && rpm > 0 ? rpm : DEFAULT_RPM;
}
const LEASE_MS = 15_000;
const MAX_INLINE_COOLDOWN_MS = 61_000;

type Ticket = { id: number; owner: string; origin: string; renewAt: number };
type Admission = { wait: number; cooldown?: boolean };

// API, worker and scripts on the deployment host mount the same data volume.
// BEGIN IMMEDIATE makes choosing a user and spending a slot one atomic operation.
export class ModelRequestBudget {
  private readonly db: Database.Database;
  private readonly insert;
  private readonly heartbeat;
  private readonly remove;
  private readonly pause;
  private readonly take;

  constructor(directory: string, rpm = configuredRpm()) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(path.join(/* turbopackIgnore: true */ directory, "model-request-rate.sqlite3"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS waiting (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, origin TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS starts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cooldown (origin TEXT PRIMARY KEY, until_ms INTEGER NOT NULL, recovery_end INTEGER NOT NULL);`);
    this.insert = this.db.prepare("INSERT INTO waiting(owner,origin,expires) VALUES(?,?,?)");
    this.heartbeat = this.db.prepare("INSERT INTO waiting(id,owner,origin,expires) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires");
    this.remove = this.db.prepare("DELETE FROM waiting WHERE id=?");
    this.pause = this.db.prepare(`INSERT INTO cooldown VALUES(?,?,?) ON CONFLICT(origin) DO UPDATE SET
      until_ms=MAX(until_ms,excluded.until_ms), recovery_end=MAX(recovery_end,excluded.recovery_end)`);
    const stale = this.db.prepare("DELETE FROM waiting WHERE expires<=?");
    const prune = this.db.prepare("DELETE FROM starts WHERE at<=?");
    const usage = this.db.prepare<[], { count: number; oldest: number }>("SELECT count(*) AS count, min(at) AS oldest FROM starts");
    const blocked = this.db.prepare<[string], { until_ms: number }>("SELECT until_ms FROM cooldown WHERE origin=?");
    // Least recently served waiting owner first, then FIFO for that owner.
    const next = this.db.prepare<[number], { id: number }>(`SELECT w.id FROM waiting w
      LEFT JOIN (SELECT owner, MAX(id) AS turn FROM starts GROUP BY owner) s ON s.owner=w.owner
      LEFT JOIN cooldown c ON c.origin=w.origin
      WHERE COALESCE(c.until_ms,0)<=? ORDER BY COALESCE(s.turn,0), w.id LIMIT 1`);
    const grant = this.db.prepare("INSERT INTO starts(owner,at) VALUES(?,?)");
    const recover = this.db.prepare("UPDATE cooldown SET until_ms=? WHERE origin=? AND recovery_end>?");
    this.take = this.db.transaction((ticket: Ticket, clock: () => number, dispatch?: () => void): Admission => {
      const now = clock(); // Sample after obtaining the cross-process write lock.
      if (now >= ticket.renewAt) {
        this.heartbeat.run(ticket.id, ticket.owner, ticket.origin, now + LEASE_MS);
        ticket.renewAt = now + LEASE_MS / 3;
      }
      stale.run(now);
      prune.run(now - WINDOW_MS);
      const until = blocked.get(ticket.origin)?.until_ms ?? 0;
      if (until > now) return { wait: until - now, cooldown: true };
      const window = usage.get()!;
      if (window.count >= rpm) return { wait: window.oldest + WINDOW_MS - now };
      if (next.get(now)?.id !== ticket.id) return { wait: 40 };
      this.remove.run(ticket.id);
      recover.run(now + WINDOW_MS / rpm, ticket.origin, now);
      // Start fetch synchronously, never await its result under the lock. Count
      // from after dispatch so tracing or scheduler stalls cannot free a slot early.
      dispatch?.();
      grant.run(ticket.owner, clock());
      return { wait: 0 };
    });
  }

  enqueue(owner: string, origin: string, now = Date.now()): Ticket {
    const { lastInsertRowid } = this.insert.run(owner, origin, now + LEASE_MS);
    return { id: Number(lastInsertRowid), owner, origin, renewAt: now + LEASE_MS / 3 };
  }

  tryTake(ticket: Ticket, clock = Date.now, dispatch?: () => void) { return this.take.immediate(ticket, clock, dispatch); }
  cancel(ticket: Ticket) { this.remove.run(ticket.id); }
  defer(origin: string, until: number) { this.pause.run(origin, until, until + WINDOW_MS); }
  close() { this.db.close(); }
}

let budget: ModelRequestBudget | undefined;
export function retryAfterMs(response: Response, now = Date.now()) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}

type Send = (endpoint: string, options: RequestInit) => Promise<Response>;

export async function fetchModelRequest(owner: string, endpoint: string, { timeoutMs, ...options }: RequestInit & { timeoutMs?: number }, send: Send = fetch): Promise<Response> {
  budget ??= new ModelRequestBudget(process.env.JIANTI_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
  const origin = new URL(endpoint).origin;
  const signal = options.signal ?? undefined;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const ticket = budget.enqueue(owner, origin);
    let granted = false;
    let pending: Promise<Response> | undefined;
    const dispatch = () => {
      const deadline = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
      const attemptSignal = deadline && signal ? AbortSignal.any([signal, deadline]) : deadline ?? signal;
      pending = send(endpoint, { ...options, signal: attemptSignal });
    };
    try {
      // Register simultaneous arrivals before choosing the first user.
      await Promise.resolve();
      for (;;) {
        signal?.throwIfAborted();
        const { wait, cooldown } = budget.tryTake(ticket, Date.now, dispatch);
        if (!wait) { granted = true; break; }
        if (cooldown && wait > MAX_INLINE_COOLDOWN_MS) {
          return Response.json({ error: { message: "Model provider is in a shared Retry-After cooldown." } },
            { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });
        }
        await sleep(Math.min(wait, LEASE_MS / 3) + Math.floor(Math.random() * 20), undefined, { signal });
      }
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      if (!granted) budget.cancel(ticket);
    }

    const response = await pending!;
    if (response.status !== 429) return response;
    const advised = retryAfterMs(response);
    const backoff = Math.max(advised ?? 0, 1000 * 2 ** attempt) + Math.ceil(Math.random() * 250);
    budget.defer(origin, Date.now() + backoff);
    if (attempt >= 2 || backoff > MAX_INLINE_COOLDOWN_MS || typeof options.body !== "string") return response;
    if ((await response.clone().text()).includes("GoUsageLimitError")) return response;
    await response.body?.cancel();
    // Rejoin the fair queue. Retries consume the same rolling budget as first attempts.
  }
}
