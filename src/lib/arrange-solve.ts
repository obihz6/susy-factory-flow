/**
 * The arrange, off the main thread.
 *
 * A judged arrange is dozens of route solves - half a minute on a busy
 * board - and half a minute on the main thread is a frozen tab. So the
 * board posts the job to a worker (`arrange.worker.ts`), shows its
 * progress, and applies the layout when it lands. One job at a time; a
 * second click while one runs is ignored by the caller. No Worker (SSR,
 * tests, a worker that cannot start): the same pure function runs here.
 */
import {
  runArrangeJob,
  type ArrangeJob,
  type ArrangeJobResult,
  type ArrangeProgress,
} from "./arrange-job";

export type { ArrangeJob, ArrangeJobResult, ArrangeProgress } from "./arrange-job";
export { ARRANGE_STEPS } from "./arrange-job";

let worker: Worker | undefined;
let workerBroken = false;
let seq = 0;
/** The job in flight, so a cancel can end it. */
let pending: { seq: number; cancel: () => void } | undefined;

/** Thrown out of arrangeInWorker when the player cancels. */
export class ArrangeCancelled extends Error {
  constructor() {
    super("Arrange cancelled");
    this.name = "ArrangeCancelled";
  }
}

/**
 * Ends the arrange in flight (Jack, 2026-09-08: "I need a way to cancel it
 * as well"). The worker runs the job synchronously and cannot hear a
 * message mid-job, so cancelling TERMINATES it; the next arrange starts a
 * fresh one. On the main-thread fallback the job cannot be stopped, so
 * its result is dropped when it lands.
 */
export function cancelArrange(): void {
  pending?.cancel();
}

/** Whether an arrange can leave the main thread at all. */
export function arrangeWorkerAvailable(): boolean {
  return !workerBroken && typeof Worker !== "undefined";
}

/**
 * Runs the job in the worker (or here, when there is none) and resolves
 * with its result. Progress arrives on `onProgress` as it happens.
 */
export function arrangeInWorker(
  job: Omit<ArrangeJob, "seq">,
  onProgress?: (progress: ArrangeProgress) => void,
): Promise<ArrangeJobResult> {
  seq += 1;
  const full: ArrangeJob = { ...job, seq };
  if (!arrangeWorkerAvailable()) {
    let cancelled = false;
    pending = { seq: full.seq, cancel: () => { cancelled = true; } };
    const result = runArrangeJob(full, onProgress);
    pending = undefined;
    return cancelled ? Promise.reject(new ArrangeCancelled()) : Promise.resolve(result);
  }
  return new Promise((resolve, reject) => {
    let target: Worker;
    try {
      target = getWorker();
    } catch (error) {
      console.error("arrange worker failed to start; arranging on the main thread", error);
      workerBroken = true;
      resolve(runArrangeJob(full, onProgress));
      return;
    }
    pending = {
      seq: full.seq,
      cancel: () => {
        target.removeEventListener("message", onMessage);
        target.removeEventListener("error", onError);
        target.terminate();
        worker = undefined;
        pending = undefined;
        reject(new ArrangeCancelled());
      },
    };
    const onMessage = (
      event: MessageEvent<{ progress?: ArrangeProgress; done?: ArrangeJobResult; error?: string }>,
    ) => {
      const data = event.data;
      if (data.progress) {
        if (data.progress.seq === full.seq) onProgress?.(data.progress);
        return;
      }
      target.removeEventListener("message", onMessage);
      target.removeEventListener("error", onError);
      pending = undefined;
      if (data.done && data.done.seq === full.seq) {
        resolve(data.done);
      } else {
        console.error("arrange worker error:", data.error ?? "unknown");
        resolve(runArrangeJob(full, onProgress));
      }
    };
    const onError = (event: ErrorEvent) => {
      target.removeEventListener("message", onMessage);
      target.removeEventListener("error", onError);
      pending = undefined;
      console.error("arrange worker broke; arranging on the main thread", event.message);
      workerBroken = true;
      resolve(runArrangeJob(full, onProgress));
    };
    target.addEventListener("message", onMessage);
    target.addEventListener("error", onError);
    target.postMessage(full);
  });
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./arrange.worker.ts", import.meta.url));
  }
  return worker;
}
