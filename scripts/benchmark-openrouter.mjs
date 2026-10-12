// Run with: node --import ./server/register.mjs --import tsx scripts/benchmark-openrouter.mjs <prepare|run> <config.json>
// This deliberately calls the existing extraction pipeline without parser/prompt changes or queue retries.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const [mode, configPath] = process.argv.slice(2);
if (!["prepare", "run"].includes(mode) || !configPath) throw new Error("Expected prepare|run and a config JSON path");
const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
const sourceRoot = path.resolve(config.sourceData);
const outputRoot = path.resolve(config.outputData);
if (sourceRoot === outputRoot || outputRoot.startsWith(sourceRoot + path.sep)) throw new Error("Use a separate benchmark directory outside live data");
const ownerId = config.ownerId ?? "local-demo";
const manifestPath = path.join(outputRoot, "benchmark.json");
const resultsPath = path.join(outputRoot, "results.json");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const { resolveFileStorageKey } = await import("../lib/storage-path.ts");

if (mode === "prepare") {
  if (fs.existsSync(outputRoot)) throw new Error("Output directory already exists; choose a fresh directory to avoid overwriting evidence");
  const api = new URL(config.localApi);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(api.hostname)) throw new Error("Profile setup must use a loopback application API");
  const source = new Database(path.join(sourceRoot, "teacher-question-bank.sqlite3"), { readonly: true, fileMustExist: true });
  const original = source.prepare("SELECT * FROM model_profiles WHERE id = ? AND owner_id = ?").get(config.keyProfileId, ownerId);
  if (!original || new URL(original.base_url).hostname !== "openrouter.ai" || original.provider !== "openai-chat-completions") throw new Error("Expected an existing OpenRouter Chat Completions profile");
  const catalogResponse = await fetch("https://openrouter.ai/api/v1/models");
  if (!catalogResponse.ok) throw new Error(`Model catalog HTTP ${catalogResponse.status}`);
  const catalog = (await catalogResponse.json()).data;
  const models = config.models.map(id => {
    const model = catalog.find(item => item.id === id);
    if (!model?.architecture?.input_modalities?.includes("image")) throw new Error(`Model missing or no image input: ${id}`);
    return model;
  });
  const papers = config.documents.map(({ id, label }) => {
    const document = source.prepare("SELECT * FROM documents WHERE id = ? AND owner_id = ?").get(id, ownerId);
    const pages = source.prepare("SELECT * FROM pages WHERE document_id = ? ORDER BY page_number").all(id);
    if (!document || pages.length !== document.page_count || pages.some((page, index) => page.page_number !== index + 1)) throw new Error(`Incomplete source pages: ${label}`);
    return { label, document, pages };
  });
  process.env.JIANTI_DATA_DIR = sourceRoot;
  const { decryptSecret } = await import("../lib/secret-box.ts");
  const apiKey = await decryptSecret(original.api_key_ciphertext, original.api_key_iv);
  const profiles = [];
  for (const model of models) {
    let profile = source.prepare("SELECT * FROM model_profiles WHERE owner_id = ? AND model = ? AND base_url = ? AND provider = ? AND enabled = 1")
      .get(ownerId, model.id, original.base_url, original.provider);
    if (!profile) {
      const response = await fetch(new URL("/api/model-profiles", api), {
        method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": ownerId },
        body: JSON.stringify({ displayName: model.id, model: model.id, baseUrl: original.base_url,
          provider: original.provider, apiKey, timeoutMs: original.timeout_ms, select: false }),
      });
      if (!response.ok) throw new Error(`Profile setup failed for ${model.id}: HTTP ${response.status}`);
      const saved = await response.json();
      profile = source.prepare("SELECT * FROM model_profiles WHERE id = ?").get(saved.profile.id);
    }
    if (profile.timeout_ms !== original.timeout_ms) throw new Error(`Timeout differs for ${model.id}; align settings before benchmarking`);
    profiles.push({ id: profile.id, model: model.id });
    console.log(JSON.stringify({ event: "configured", model: model.id }));
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  await source.backup(path.join(outputRoot, "teacher-question-bank.sqlite3"));
  if (fs.existsSync(path.join(sourceRoot, ".model-key-secret"))) fs.copyFileSync(path.join(sourceRoot, ".model-key-secret"), path.join(outputRoot, ".model-key-secret"));
  const copied = new Map();
  for (const paper of papers) {
    for (const key of [paper.document.original_key, ...paper.pages.map(page => page.storage_key)].filter(Boolean)) {
      if (copied.has(key)) continue;
      const bytes = fs.readFileSync(resolveFileStorageKey(sourceRoot, key));
      const target = resolveFileStorageKey(outputRoot, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      copied.set(key, hash(bytes));
    }
  }
  json(manifestPath, { createdAt: new Date().toISOString(), ownerId, concurrency: Math.min(2, Math.max(1, config.concurrency ?? 2)),
    timeoutMs: original.timeout_ms, profiles, models, papers, sourceFiles: Object.fromEntries(copied),
    method: "Same stored PDF/pages, production extraction and finalization; one pipeline attempt per model/paper; existing HTTP compatibility fallback preserved; no queue retries." });
  source.close();
  console.log(JSON.stringify({ event: "prepared", papers: papers.length, models: models.length, outputRoot }));
  process.exit(0);
}

if (fs.existsSync(resultsPath)) throw new Error("Results already exist: refusing to repeat paid calls. Review the previous run first.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const [key, expected] of Object.entries(manifest.sourceFiles)) {
  if (hash(fs.readFileSync(resolveFileStorageKey(outputRoot, key))) !== expected) throw new Error(`Source file changed: ${key}`);
}
process.env.JIANTI_DATA_DIR = outputRoot;
process.env.JIANTI_PROCESS_ROLE = "benchmark";
process.env.JIANTI_EMBEDDED_WORKER = "0";
const { ensureDatabase } = await import("../db/bootstrap.ts");
const { getSqlite } = await import("../db/index.ts");
await ensureDatabase();
const sqlite = getSqlite();
sqlite.prepare("UPDATE app_settings SET extraction_paused = 1").run();
sqlite.prepare("UPDATE document_jobs SET status = 'paused', lease_owner = NULL, lease_expires_at = NULL").run();
const { enqueueDocumentExtraction } = await import("../lib/extraction-queue.ts");
const { extractDocument } = await import("../server/services/extraction.ts");
const { finalizeDocument } = await import("../server/services/document-finalize.ts");
function insert(table, row) {
  const columns = Object.keys(row);
  sqlite.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
}
const trials = manifest.papers.flatMap(paper => manifest.profiles.map(profile => {
  const documentId = randomUUID();
  const timestamp = new Date().toISOString();
  sqlite.transaction(() => {
    insert("documents", { ...paper.document, id: documentId, status: "uploading", checksum: null,
      error: null, source_removed_at: null, created_at: timestamp, updated_at: timestamp });
    for (const page of paper.pages) insert("pages", { ...page, id: randomUUID(), document_id: documentId, created_at: timestamp });
  })();
  return { model: profile.model, profileId: profile.id, sourceId: paper.document.id, label: paper.label,
    name: paper.document.name, pages: paper.pages.length, documentId, state: "pending" };
}));
const report = { startedAt: new Date().toISOString(), method: manifest.method, trials };
json(resultsPath, report);

function readTrace(traceId) {
  const root = path.join(outputRoot, "model-traces");
  const directory = traceId && fs.existsSync(root) ? fs.readdirSync(root).map(day => path.join(root, day, traceId)).find(item => fs.existsSync(item)) : null;
  if (!directory) return {};
  const files = fs.readdirSync(directory);
  const responses = files.filter(file => /^response-\d+\.raw$/.test(file)).map(file => {
    let usage = null;
    let generationId = null;
    let provider = null;
    let finishReason = null;
    for (const line of fs.readFileSync(path.join(directory, file), "utf8").split(/\r?\n/)) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.usage) usage = event.usage;
        generationId = event.id ?? generationId;
        provider = event.provider ?? provider;
        finishReason = event.choices?.[0]?.finish_reason ?? finishReason;
      } catch { /* Keep incomplete SSE evidence without inventing usage. */ }
    }
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, file.replace(".raw", ".json")), "utf8"));
    return { httpStatus: metadata.status, generationId, provider, finishReason, usage };
  });
  const firstRequest = JSON.parse(fs.readFileSync(path.join(directory, "request-1.json"), "utf8"));
  const bodyWithoutModel = { ...firstRequest.body };
  delete bodyWithoutModel.model;
  const costKnown = responses.length > 0 && responses.every(response => response.httpStatus >= 400 || typeof response.usage?.cost === "number");
  return { traceId, inputHash: hash(JSON.stringify(bodyWithoutModel)), httpRequests: files.filter(file => /^request-\d+\.json$/.test(file)).length,
    costUsd: costKnown ? responses.reduce((sum, response) => sum + (response.usage?.cost ?? 0), 0) : null, responses };
}
async function run(trial) {
  trial.state = "running";
  trial.startedAt = new Date().toISOString();
  json(resultsPath, report);
  console.log(JSON.stringify({ event: "start", model: trial.model, paper: trial.label }));
  const start = Date.now();
  try {
    await enqueueDocumentExtraction({ ownerId: manifest.ownerId, documentId: trial.documentId, profileId: trial.profileId, retry: true });
    const extracted = await extractDocument(manifest.ownerId, { documentId: trial.documentId, fileName: trial.name, profileId: trial.profileId });
    const outcome = extracted.status < 400 ? await finalizeDocument(manifest.ownerId, trial.documentId) : extracted;
    Object.assign(trial, readTrace(extracted.body.traceId), { state: outcome.status < 400 ? "passed" : "failed",
      status: outcome.status, error: outcome.body.error ?? null, code: outcome.body.code ?? null });
  } catch (error) {
    Object.assign(trial, { state: "harness_error", error: error instanceof Error ? error.message : String(error), costUsd: null });
  }
  trial.seconds = Number(((Date.now() - start) / 1000).toFixed(1));
  trial.questions = sqlite.prepare("SELECT COUNT(*) AS count FROM questions WHERE document_id = ?").get(trial.documentId).count;
  trial.needsHumanReview = sqlite.prepare("SELECT COUNT(*) AS count FROM questions WHERE document_id = ? AND needs_human_review = 1").get(trial.documentId).count;
  trial.finishedAt = new Date().toISOString();
  json(resultsPath, report);
  console.log(JSON.stringify({ event: "result", model: trial.model, paper: trial.label, state: trial.state,
    seconds: trial.seconds, questions: trial.questions, costUsd: trial.costUsd, error: trial.error }));
}
let next = 0;
await Promise.all(Array.from({ length: manifest.concurrency }, async () => {
  while (next < trials.length) await run(trials[next++]);
}));
report.finishedAt = new Date().toISOString();
json(resultsPath, report);
sqlite.close();
console.log(JSON.stringify({ event: "finished", resultsPath }));
