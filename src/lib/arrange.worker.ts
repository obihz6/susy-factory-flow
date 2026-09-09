import { runArrangeJob, type ArrangeJob } from "./arrange-job";

/**
 * The arranger, off the main thread. One job in; progress messages as it
 * goes; one result out. The scheduling lives in `arrange-solve.ts`; this
 * file stays a dumb calculator on purpose.
 */
self.onmessage = (event: MessageEvent<ArrangeJob>) => {
  try {
    const done = runArrangeJob(event.data, (progress) => {
      self.postMessage({ progress });
    });
    self.postMessage({ done });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
