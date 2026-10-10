import { getSqlite, sqliteTransaction } from "../../db";
import { ensureDatabase } from "../../db/bootstrap";
import { getFile } from "../../lib/file-storage";
import { enqueueDocumentExtraction } from "../../lib/extraction-queue";
import { ModelConfigurationError, resolveModelProfile } from "../../lib/model-profiles";
import { now } from "../../lib/server";
import { readProcessorEvents } from "../contracts/processor";
import { result } from "../core/result";
import { uploadDocumentPage } from "./document-pages";

const leaseMs = Math.max(3000, Number(process.env.JIANTI_PREPARATION_LEASE_MS) || 90000);
type Preparation = { document_id: string; owner_id: string; profile_id: string | null; attempt: number; lease_owner: string; original_key: string };
let running = false;
class PreparationFailure extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export function processorConfigured() { return Boolean(process.env.JIANTI_DOCUMENT_PROCESSOR_URL); }

export async function enqueueDocumentPreparation(ownerId: string, documentId: string, profileId?: string) {
  await ensureDatabase();
  if (!processorConfigured()) return result({ error: "未启用后台 PDF 分页，请重新上传同一 PDF 由浏览器补齐页面", code: "processor_unavailable" }, { status: 503 });
  return sqliteTransaction(sqlite => {
    const document = sqlite.prepare("SELECT original_key, source_removed_at, status FROM documents WHERE id=? AND owner_id=?")
      .get(documentId, ownerId) as { original_key: string | null; source_removed_at: string | null; status: string } | undefined;
    if (!document || !document.original_key || document.source_removed_at) return result({ error: "原卷不存在" }, { status: 404 });
    if (document.status === "complete") return result({ preparationQueued: false, status: "complete" });
    // Avoid two writers (PDF preparation and model extraction) changing the source.
    if (sqlite.prepare("SELECT 1 FROM document_jobs WHERE document_id=? AND status IN ('queued','processing','retry_wait')").get(documentId)) {
      return result({ error: "原卷正在识别，请等待当前任务结束", code: "document_busy" }, { status: 409 });
    }
    sqlite.prepare(`INSERT INTO document_preparations (document_id, owner_id, profile_id, status, updated_at)
      VALUES (?, ?, ?, 'queued', ?) ON CONFLICT(document_id) DO UPDATE SET
      profile_id=COALESCE(excluded.profile_id, document_preparations.profile_id),
      status=CASE WHEN document_preparations.status IN ('queued','processing','retry_wait') THEN document_preparations.status ELSE 'queued' END,
      attempt=CASE WHEN document_preparations.status IN ('failed','complete') THEN 0 ELSE document_preparations.attempt END,
      next_attempt_at=CASE WHEN document_preparations.status IN ('failed','complete') THEN NULL ELSE document_preparations.next_attempt_at END,
      last_error=NULL, updated_at=excluded.updated_at`).run(documentId, ownerId, profileId ?? null, now());
    sqlite.prepare("UPDATE documents SET status='uploading', error=NULL, updated_at=? WHERE id=? AND owner_id=?").run(now(), documentId, ownerId);
    return result({ preparationQueued: true }, { status: 202 });
  });
}

export function getDocumentPreparation(ownerId: string, documentId: string) {
  return getSqlite().prepare(`SELECT status, completed_pages AS completedPages, last_error AS lastError,
    next_attempt_at AS nextAttemptAt FROM document_preparations WHERE owner_id=? AND document_id=?`).get(ownerId, documentId);
}
export function listDocumentPreparations(ownerId: string) {
  return getSqlite().prepare(`SELECT p.document_id AS documentId, p.status, p.completed_pages AS completedPages,
    d.page_count AS pageCount, p.last_error AS lastError FROM document_preparations p
    JOIN documents d ON d.id=p.document_id WHERE p.owner_id=? ORDER BY p.updated_at DESC LIMIT 100`).all(ownerId);
}

function owned(job: Preparation) {
  return Boolean(getSqlite().prepare(`SELECT 1 FROM document_preparations p JOIN documents d ON d.id=p.document_id
    WHERE p.document_id=? AND p.owner_id=? AND p.lease_owner=? AND p.status='processing'
    AND p.lease_expires_at>? AND d.source_removed_at IS NULL`).get(job.document_id, job.owner_id, job.lease_owner, now()));
}

async function processPreparation(job: Preparation) {
  const controller = new AbortController();
  const beat = setInterval(() => {
    try {
    if (!owned(job)) { controller.abort(); return; }
    getSqlite().prepare(`UPDATE document_preparations SET lease_expires_at=?, updated_at=?
      WHERE document_id=? AND lease_owner=? AND status='processing'`).run(new Date(Date.now() + leaseMs).toISOString(), now(), job.document_id, job.lease_owner);
    } catch (error) { console.error("[worker] PDF lease renewal failed", error); controller.abort(); }
  }, Math.min(25000, Math.floor(leaseMs / 3)));
  try {
    const endpoint = new URL("/v1/pdf/pages", process.env.JIANTI_DOCUMENT_PROCESSOR_URL);
    if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("PDF 处理服务地址必须是 HTTP(S)");
    const token = process.env.JIANTI_PROCESSOR_TOKEN ?? "";
    if (token.length < 32) throw new Error("PDF 处理服务密钥至少需要 32 个字符");
    const bytes = await getFile(job.original_key);
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/pdf", "x-processor-token": token },
      body: bytes, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60 * 1000)]) });
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({})) as { error?: string };
      throw new PreparationFailure(error.error ?? `PDF 处理服务返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429);
    }
    let pageCount = 0;
    let received = 0;
    let complete = false;
    for await (const event of readProcessorEvents(response.body)) {
      if (!owned(job)) throw new Error("PDF 分页任务租约已失效");
      if (complete) throw new Error("PDF 处理服务在结束后仍返回页面");
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "metadata") {
        if (pageCount) throw new Error("PDF 处理服务重复返回页数");
        pageCount = event.pageCount;
        sqliteTransaction(sqlite => {
          if (!owned(job)) throw new Error("PDF 分页任务租约已失效");
          sqlite.prepare("UPDATE documents SET page_count=?, updated_at=? WHERE id=? AND owner_id=?").run(pageCount, now(), job.document_id, job.owner_id);
          sqlite.prepare("UPDATE document_preparations SET completed_pages=0 WHERE document_id=? AND lease_owner=?").run(job.document_id, job.lease_owner);
        });
      } else if (event.type === "page") {
        if (!pageCount || event.pageNumber !== received + 1 || event.pageNumber > pageCount) throw new Error("PDF 分页顺序或页数无效");
        received++;
        // Preserve existing evidence: a resumed upload fills missing pages only.
        if (!getSqlite().prepare("SELECT 1 FROM pages WHERE document_id=? AND page_number=?").get(job.document_id, event.pageNumber)) {
          const form = new FormData();
          form.set("page", new File([Buffer.from(event.jpeg, "base64")], `page-${event.pageNumber}.jpg`, { type: "image/jpeg" }));
          form.set("pageNumber", String(event.pageNumber)); form.set("width", String(event.width)); form.set("height", String(event.height));
          const saved = await uploadDocumentPage(job.owner_id, job.document_id, form, job.lease_owner);
          if (saved.status >= 400) throw new Error(String((saved.body as { error?: string }).error ?? "分页保存失败"));
        }
        getSqlite().prepare("UPDATE document_preparations SET completed_pages=?, updated_at=? WHERE document_id=? AND lease_owner=? AND status='processing'")
          .run(received, now(), job.document_id, job.lease_owner);
      } else {
        if (!pageCount || received !== pageCount || event.pageCount !== pageCount) throw new Error("PDF 分页没有完整返回");
        complete = true;
      }
    }
    if (!complete) throw new Error("PDF 处理流提前中断");
    // Queue handoff and preparation completion must commit atomically. Otherwise
    // a crash between them leaves a fully rendered document without an AI job.
    let modelReady = true;
    try { await resolveModelProfile(job.owner_id, job.profile_id ?? undefined); }
    catch (error) { if (error instanceof ModelConfigurationError) modelReady = false; else throw error; }
    const commit = (sqlite: ReturnType<typeof getSqlite>) => {
      if (!owned(job)) throw new Error("PDF 分页任务租约已失效");
      sqlite.prepare("UPDATE document_preparations SET status='complete', lease_owner=NULL, lease_expires_at=NULL, last_error=NULL, updated_at=? WHERE document_id=? AND lease_owner=?")
        .run(now(), job.document_id, job.lease_owner);
      if (!modelReady) sqlite.prepare("UPDATE documents SET status='awaiting_model', error=NULL, updated_at=? WHERE id=? AND owner_id=?").run(now(), job.document_id, job.owner_id);
    };
    if (modelReady) await enqueueDocumentExtraction({ ownerId: job.owner_id, documentId: job.document_id, profileId: job.profile_id ?? undefined, retry: true, commit });
    else sqliteTransaction(commit);
  } catch (error) {
    if (!owned(job)) return;
    const message = error instanceof Error ? error.message : "后台 PDF 分页失败";
    const failed = job.attempt >= 3 || (error instanceof PreparationFailure && !error.retryable);
    sqliteTransaction(sqlite => {
      if (!owned(job)) return;
      sqlite.prepare(`UPDATE document_preparations SET status=?, lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=?, last_error=?, updated_at=? WHERE document_id=? AND lease_owner=?`)
        .run(failed ? "failed" : "retry_wait", failed ? null : new Date(Date.now() + 2000 * 2 ** job.attempt).toISOString(), message, now(), job.document_id, job.lease_owner);
      if (failed) sqlite.prepare("UPDATE documents SET status='failed', error=?, updated_at=? WHERE id=? AND owner_id=?").run(message, now(), job.document_id, job.owner_id);
    });
  } finally { clearInterval(beat); controller.abort(); }
}

export async function kickDocumentPreparation() {
  if (running || !processorConfigured()) return;
  running = true;
  try {
    await ensureDatabase();
    const job = sqliteTransaction(sqlite => {
      const timestamp = now();
      sqlite.prepare(`UPDATE document_preparations SET status='retry_wait', next_attempt_at=?, lease_owner=NULL,
        lease_expires_at=NULL, last_error='工作进程中断，等待恢复' WHERE status='processing' AND lease_expires_at<=?`).run(timestamp, timestamp);
      const candidate = sqlite.prepare(`SELECT p.*, d.original_key FROM document_preparations p JOIN documents d ON d.id=p.document_id
        WHERE p.status IN ('queued','retry_wait') AND (p.next_attempt_at IS NULL OR p.next_attempt_at<=?)
        AND d.source_removed_at IS NULL ORDER BY p.updated_at LIMIT 1`).get(timestamp) as Preparation | undefined;
      if (!candidate) return;
      candidate.lease_owner = crypto.randomUUID(); candidate.attempt++;
      sqlite.prepare("UPDATE document_preparations SET status='processing', attempt=?, lease_owner=?, lease_expires_at=?, updated_at=? WHERE document_id=?")
        .run(candidate.attempt, candidate.lease_owner, new Date(Date.now() + leaseMs).toISOString(), timestamp, candidate.document_id);
      return candidate;
    });
    if (job) await processPreparation(job);
  } finally { running = false; }
}
