import { startHeartbeat } from "./runtime";
import { kickExtractionQueue } from "../lib/extraction-queue";
import { kickDocumentPreparation } from "./services/document-preparation";
import { kickAuthoringPlanning } from "./services/authoring";
import { kickAuthoringChapters } from "./services/authoring-chapters";
import { kickWholePaperVariations } from "./services/authoring-variations";
import { kickClassificationBatch } from "./services/classification-batches";

process.env.JIANTI_PROCESS_ROLE = "worker";
const stopHeartbeat = await startHeartbeat("worker");
let stopping = false;
let extracting = false;
let authoring = false;
let classifying = false;
function tick() {
  if (stopping) return;
  if (!classifying) {
    classifying = true;
    void Promise.allSettled([kickClassificationBatch(),kickClassificationBatch()]).then(results=>{for(const result of results)if(result.status==='rejected')console.error("[worker] classification failed",result.reason);}).finally(()=>{classifying=false;});
  }
  if (!authoring) {
    authoring = true;
    void (async () => { await kickAuthoringPlanning(); await kickAuthoringChapters(); await kickWholePaperVariations(); })().catch(error => console.error("[worker] authoring failed", error)).finally(() => { authoring = false; });
  }
  if (!extracting) {
    extracting = true;
    void kickExtractionQueue().catch(error => console.error("[worker] queue failed", error)).finally(() => { extracting = false; });
  }
  void kickDocumentPreparation().catch(error => console.error("[worker] preparation failed", error));
}
tick();
const timer = setInterval(tick, 1000);
console.log(`[worker] ready pid=${process.pid}`);
function shutdown() {
  stopping = true;
  clearInterval(timer);
  stopHeartbeat();
  // In-flight jobs keep their durable lease. A replacement worker resumes them
  // after lease expiry, and stale results are rejected by ownership checks.
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
