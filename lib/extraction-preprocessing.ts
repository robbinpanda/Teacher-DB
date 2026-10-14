import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import path from "node:path";
import type { SourceQuestionInventory } from "./source-question-inventory.ts";
import type { PageAssetCandidate } from "./asset-review";

export const PREPROCESSING_CONCURRENCY = Math.min(3, Math.max(1, Math.floor(availableParallelism() / 2)));
type Input = { originalPath?: string; pages: Array<{ pageNumber: number; path: string }> };
export type PreprocessingProgress = { phase: "inventory" | "images"; completedPages: number };
export type PreprocessingResult = {
  sourceInventory: SourceQuestionInventory | null; inventoryError?: string;
  modelImages: Array<{ page: number; dataUrl: string }>; candidates: PageAssetCandidate[];
  pageBytes: Array<{ page: number; bytes: Uint8Array }>;
  timings: { inventoryMs: number; detectMs: number; annotateMs: number; totalMs: number; pages: number };
};
type Task = { input: Input; onProgress?: (progress: PreprocessingProgress) => void; resolve: (result: PreprocessingResult) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; task?: Task };
const queue: Task[] = [], slots: Slot[] = [];

function pump() {
  while (queue.length) {
    let slot = slots.find(item => !item.task);
    if (!slot && slots.length < PREPROCESSING_CONCURRENCY) {
      // Backend services run from the project root; keep this Node worker outside Next's browser-worker bundling.
      const worker = new Worker(path.resolve("lib", "extraction-preprocessing-worker.mjs"), { execArgv: ["--experimental-strip-types"] });
      slot = { worker };
      const current = slot;
      slots.push(current);
      const remove = (error: Error) => {
        const index = slots.indexOf(current);
        if (index < 0) return;
        slots.splice(index, 1);
        current.task?.reject(error); current.task = undefined;
        void worker.terminate();
        pump();
      };
      worker.on("error", remove);
      worker.on("exit", code => remove(new Error(`图像预处理工作线程退出（${code}）`)));
      worker.on("message", (message) => {
        const task = current.task;
        if (!task) return;
        if (message.type === "progress") {
          try { task.onProgress?.(message); } catch (error) { remove(error instanceof Error ? error : new Error(String(error))); }
          return;
        }
        current.task = undefined;
        worker.unref();
        if (message.type === "result") task.resolve(message.result);
        else task.reject(Object.assign(new Error(message.message || "图像预处理失败"), { code: message.code }));
        pump();
      });
    }
    if (!slot) break;
    slot.task = queue.shift()!;
    slot.worker.ref();
    slot.worker.postMessage(slot.task.input);
  }
}

/** Keep CPU work bounded and off the event loop that receives all model streams and renews leases. */
export function prepareExtractionInput(input: Input, onProgress?: Task["onProgress"]): Promise<PreprocessingResult> {
  return new Promise((resolve, reject) => { queue.push({ input, onProgress, resolve, reject }); pump(); });
}

export async function closePreprocessingWorkers() {
  if (queue.length || slots.some(slot => slot.task)) throw new Error("预处理任务尚未完成");
  const workers = slots.splice(0);
  await Promise.all(workers.map(slot => slot.worker.terminate()));
}
