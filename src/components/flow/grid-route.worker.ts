import {
  decodeRouteSolveJob,
  runRouteSolveJob,
  type EncodedRouteSolveJob,
} from "./grid-route-job";

/**
 * The grid router, off the main thread. One job in, one result out; the
 * scheduling (coalescing drag beats, dropping superseded jobs, deciding
 * whether an answer is still current) lives in `grid-route-solve.ts` and
 * `FactoryFlow.tsx`. This file stays a dumb calculator on purpose.
 */
self.onmessage = (event: MessageEvent<EncodedRouteSolveJob>) => {
  try {
    self.postMessage(runRouteSolveJob(decodeRouteSolveJob(event.data)));
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
