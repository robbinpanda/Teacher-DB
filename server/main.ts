import "reflect-metadata";
import { All, Controller, Module, Req, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dispatchRequest } from "./http/router";
import { startHeartbeat } from "./runtime";
import { ensureDatabase, DATABASE_VERSION } from "../db/bootstrap";
import { authenticate, AuthenticationError, assertAuthenticationConfiguration, tenantContext } from "./core/tenant";
import { verifyPaperExportToken } from "../lib/paper-export-token";
import { result, toResponse } from "./core/result";
import { getSqlite } from "../db";

class ApiController {
  async handle(incoming: IncomingMessage, outgoing: ServerResponse) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
    const url = new URL(incoming.url ?? "/", process.env.APP_BASE_URL ?? "http://127.0.0.1:3050");
    if (url.pathname === "/api/ready") {
      const workerReady = Boolean(getSqlite().prepare("SELECT 1 FROM runtime_processes WHERE role='worker' AND expires_at>? LIMIT 1").get(new Date().toISOString()));
      const requireWorker = url.searchParams.get("dependencies") === "1";
      outgoing.statusCode = requireWorker && !workerReady ? 503 : 200;
      outgoing.setHeader("content-type", "application/json");
      outgoing.setHeader("cache-control", "no-store");
      outgoing.end(JSON.stringify({ ok: !requireWorker || workerReady, role: "api", workerReady, schemaVersion: DATABASE_VERSION, instanceId: process.env.JIANTI_INSTANCE_ID ?? null, pid: process.pid }));
      return;
    }
    if (Number(headers.get("content-length")) > 125 * 1024 * 1024) {
      const requestId = crypto.randomUUID();
      outgoing.setHeader("x-request-id", requestId);
      outgoing.writeHead(413, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "请求内容超过 125 MB", code: "payload_too_large", retryable: false, requestId }));
      return;
    }
    const init: RequestInit & { duplex?: "half" } = { method: incoming.method, headers };
    if (!["GET", "HEAD"].includes(incoming.method ?? "GET")) {
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      init.duplex = "half";
    }
    let response: Response;
    const request = new Request(url, init);
    try {
      let tenant;
      try { tenant = authenticate(headers); }
      catch (error) {
        // Chromium's print-only page uses a short-lived paper capability.
        // This exception grants access to this single read model, never the
        // owner's general API, files, or other paper resources.
        if (!(error instanceof AuthenticationError) || url.pathname !== "/api/view" || request.method !== "POST") throw error;
        const query = await request.clone().json().catch(() => null);
        const claims = query?.resource === "paper-print" && typeof query.id === "string" && typeof query.token === "string"
          ? verifyPaperExportToken(query.token, query.id) : null;
        if (!claims) throw error;
        tenant = { ownerId: claims.ownerId, authentication: "jwt" as const };
      }
      response = await tenantContext.run(tenant, () => dispatchRequest(request));
    } catch (error) {
      if (!(error instanceof AuthenticationError)) throw error;
      const requestId = crypto.randomUUID();
      response = toResponse(result({ error: error.message, code: error.code, retryable: false, requestId }, { status: error.status }));
      response.headers.set("x-request-id", requestId);
    }
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    if (response.body) {
      const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      stream.on("error", error => outgoing.destroy(error));
      outgoing.on("close", () => stream.destroy());
      stream.pipe(outgoing);
    } else outgoing.end();
  }
}

// Explicit decorator calls work with the shared TS/ESM runner without relying
// on compiler-emitted dependency-injection metadata.
Controller("api")(ApiController);
All("{*path}")(ApiController.prototype, "handle", Object.getOwnPropertyDescriptor(ApiController.prototype, "handle")!);
Req()(ApiController.prototype, "handle", 0);
Res()(ApiController.prototype, "handle", 1);
class BackendModule {}
Module({ controllers: [ApiController] })(BackendModule);

process.env.JIANTI_PROCESS_ROLE = "api";
assertAuthenticationConfiguration();
await ensureDatabase();
const stopHeartbeat = await startHeartbeat("api");
const app = await NestFactory.create(BackendModule, { bodyParser: false, abortOnError: false });
const host = process.env.JIANTI_API_HOST ?? "127.0.0.1";
const port = Number(process.env.JIANTI_API_PORT ?? 3051);
await app.listen(port, host);
console.log(`[api] ready http://${host}:${port} schema=${DATABASE_VERSION}`);

async function shutdown() {
  stopHeartbeat();
  await app.close();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
