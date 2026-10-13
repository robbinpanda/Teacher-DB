// Local evidence only. Run after benchmark-openrouter run; --billing reads receipts, never generates.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const [directory, flag] = process.argv.slice(2);
if (!directory || (flag && flag !== "--billing")) throw new Error("Expected output directory [--billing]");
const root = path.resolve(directory);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const runs = read(path.join(root, "results.json"));
if (!runs.finishedAt) throw new Error("Wait until the trial has finished");
process.env.JIANTI_DATA_DIR = root;
const database = new Database(path.join(root, "teacher-question-bank.sqlite3"), { readonly: true });
const reportPath = path.join(root, "question-review-costs.json");
const previous = fs.existsSync(reportPath) ? read(reportPath) : null;
const receipts = new Map((previous?.trials ?? []).flatMap(trial => trial.calls.flatMap(call => call.responses))
  .filter(response => response.billing).map(response => [response.generationId, response.billing]));
const traceRoot = path.join(root, "model-traces");
const directories = fs.readdirSync(traceRoot).flatMap(day => fs.readdirSync(path.join(traceRoot, day))
  .map(id => path.join(traceRoot, day, id)));
const { decryptSecret } = await import("../lib/secret-box.ts");
const report = { startedAt: runs.startedAt, finishedAt: runs.finishedAt, checkedAt: new Date().toISOString(), trials: [] };

function parseResponse(raw) {
  const events = [];
  try { events.push(JSON.parse(raw)); }
  catch {
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* Partial SSE or DONE. */ }
    }
  }
  const response = {};
  for (const event of events) {
    if (event.id) response.generationId = event.id;
    if (event.usage) response.usage = event.usage;
    if (event.provider) response.provider = event.provider;
    if (event.choices?.[0]?.finish_reason) response.finishReason = event.choices[0].finish_reason;
  }
  return response;
}

function totals(calls) {
  const responses = calls.flatMap(call => call.responses);
  const cost = response => response.billing?.totalCostUsd ?? response.usage?.cost;
  const input = response => response.billing?.promptTokens ?? response.usage?.prompt_tokens;
  const output = response => response.billing?.completionTokens ?? response.usage?.completion_tokens;
  const known = responses.filter(response => typeof cost(response) === "number");
  const httpRequests = calls.reduce((n, call) => n + call.httpRequests, 0);
  const missingResponses = httpRequests - responses.length;
  return { sessions: calls.length, httpRequests, missingResponses,
    responses: responses.length, billedResponses: responses.filter(response => response.billing).length,
    unpricedResponses: responses.length - known.length,
    costUsd: !missingResponses && responses.length === known.length ? known.reduce((n, response) => n + cost(response), 0) : null,
    knownCostUsd: known.reduce((n, response) => n + cost(response), 0),
    inputTokens: responses.every(response => typeof input(response) === "number") ? responses.reduce((n, response) => n + input(response), 0) : null,
    outputTokens: responses.every(response => typeof output(response) === "number") ? responses.reduce((n, response) => n + output(response), 0) : null,
    cachedTokens: responses.reduce((n, response) => n + (response.billing?.cachedTokens ?? response.usage?.prompt_tokens_details?.cached_tokens ?? 0), 0) };
}

for (const run of runs.trials) {
  const profile = database.prepare("SELECT * FROM model_profiles WHERE id=?").get(run.profileId);
  if (!profile || new URL(profile.base_url).hostname !== "openrouter.ai") throw new Error("Expected configured OpenRouter profile");
  const apiKey = flag === "--billing" ? await decryptSecret(profile.api_key_ciphertext, profile.api_key_iv) : null;
  const calls = [];
  for (const directory of directories) {
    const manifest = read(path.join(directory, "manifest.json"));
    if (manifest.documentId !== run.documentId) continue;
    const files = fs.readdirSync(directory);
    const request = read(path.join(directory, "request-1.json"));
    const result = files.includes("result.json") ? read(path.join(directory, "result.json")) : null;
    const responses = [];
    for (const file of files.filter(file => /^response-\d+\.json$/.test(file))) {
      const metadata = read(path.join(directory, file));
      const rawFile = path.join(directory, file.replace(".json", ".raw"));
      const response = { httpStatus: metadata.status, ...parseResponse(fs.existsSync(rawFile) ? fs.readFileSync(rawFile, "utf8") : "") };
      response.billing = receipts.get(response.generationId) ?? null;
      if (apiKey && response.generationId && !response.billing) {
        const url = new URL("https://openrouter.ai/api/v1/generation");
        url.searchParams.set("id", response.generationId);
        try {
          const fetched = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) });
          response.billingLookupStatus = fetched.status;
          if (fetched.ok) {
            const { data } = await fetched.json();
            response.billing = { totalCostUsd: data.total_cost, model: data.model, provider: data.provider_name,
              promptTokens: data.native_tokens_prompt, completionTokens: data.native_tokens_completion,
              cachedTokens: data.native_tokens_cached, reasoningTokens: data.native_tokens_reasoning,
              finishReason: data.finish_reason, cancelled: data.cancelled };
          }
        } catch (error) { response.billingLookupError = error.message; }
      }
      responses.push(response);
    }
    const user = request.body.messages?.find(message => message.role === "user");
    const texts = user?.content?.filter(item => item.type === "text").map(item => item.text) ?? [];
    let questionNumber = null;
    for (const text of texts) { try { questionNumber = JSON.parse(text).number ?? questionNumber; } catch { /* Page labels. */ } }
    calls.push({ traceId: manifest.traceId, purpose: manifest.purpose, model: manifest.model,
      startedAt: manifest.startedAt, finishedAt: result?.finishedAt, transportStatus: result?.status,
      seconds: result ? (Date.parse(result.finishedAt) - Date.parse(manifest.startedAt)) / 1000 : null,
      httpRequests: files.filter(file => /^request-\d+\.json$/.test(file)).length,
      questionNumber, messageCount: request.body.messages?.length,
      imageCount: user?.content?.filter(item => item.type === "image_url").length,
      maxOutputTokens: request.body.max_tokens, responses,
      verdict: manifest.purpose === "question_review" && files.includes("output.txt") ? fs.readFileSync(path.join(directory, "output.txt"), "utf8") : undefined });
  }
  const questions = database.prepare("SELECT number, status, needs_human_review, ai_review_json FROM questions WHERE document_id=? ORDER BY CAST(number AS INTEGER)")
    .all(run.documentId).map(row => ({ number: row.number, status: row.status, needsHumanReview: Boolean(row.needs_human_review), aiReview: JSON.parse(row.ai_review_json || "null") }));
  const reviews = calls.filter(call => call.purpose === "question_review");
  const summary = { extraction: totals(calls.filter(call => call.purpose !== "question_review")), review: totals(reviews), total: totals(calls),
    verdicts: Object.fromEntries(["passed", "issues", "failed", "pending", "stale", "missing"].map(status => [status, questions.filter(q => (q.aiReview?.status ?? "missing") === status).length])),
    reviewSeconds: reviews.map(call => call.seconds) };
  report.trials.push({ documentId: run.documentId, model: run.model, label: run.label, pipelineState: run.state,
    seconds: run.seconds, questionCount: questions.length, summary, questions, calls });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ label: run.label, seconds: run.seconds, questions: questions.length, ...summary }));
}
database.close();
console.log(JSON.stringify({ reportPath }));
