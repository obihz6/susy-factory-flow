
/**
 * The wire solve, off the main thread.
 *
 * The grid router is a pure function of published geometry, which makes it
 * a natural worker job - and on a big board it has to be one. Routing runs
 * inside the edge components' render, so a solve that takes half a second
 * is half a second in which nothing on the page moves: no drag frame, no
 * typed digit, no hover. The board therefore posts any solve past
 * `ASYNC_ROUTE_EDGE_LIMIT` wires here and keeps drawing the routes it
 * already has until the answer lands (`FactoryFlow.tsx` installs it and
 * re-issues the edges). Same inputs, same pure function, same routes as the
 * synchronous path - only the thread differs, so the routing invariant in
 * ARCHITECTURE.md (routes depend on flow-space geometry alone) still holds.
 *
 * Scheduling is the same shape as `solve-books.ts`: one job in flight, and
 * only the NEWEST waiting job kept, because a drag publishes a fresh
 * geometry several times a second and every intermediate one is already
 * superseded by the time the worker is free. Results carry a sequence
 * number so the board can tell a late answer from a current one.
 */
import {
  encodeRouteSolveJob,
  runRouteSolveJob,
  type RouteSolveJob,
  type RouteSolveResult,
} from "./grid-route-job";

export {
  ASYNC_ROUTE_EDGE_LIMIT,
  decodeRouteSolveJob,
  encodeRouteSolveJob,
  runRouteSolveJob,
  type EncodedRouteSolveJob,
  type RouteSolveJob,
  type RouteSolveResult,
} from "./grid-route-job";

type RouteSolveSink = (result: RouteSolveResult) => void;

let worker: Worker | undefined;
let workerBroken = false;
let inFlight: RouteSolveJob | undefined;
let queued: RouteSolveJob | undefined;
let sink: RouteSolveSink | undefined;
let lastSolveDurationMs: number | undefined;

/** Whether a solve can leave the main thread at all (no Worker in SSR/tests). */
export function routeWorkerAvailable(): boolean {
  return !workerBroken && typeof Worker !== "undefined";
}

/** How long the last worker solve took, for anyone deciding what to follow. */
export function lastRouteSolveDurationMs(): number | undefined {
  return lastSolveDurationMs;
}

/** Where finished routes go. One board at a time, like every route cache. */
export function setRouteSolveSink(next: RouteSolveSink | undefined) {
  sink = next;
}

/**
 * Posts a job, or parks it behind the one running. A parked job replaces
 * any job parked before it: geometry that has already changed again is not
 * worth solving.
 */
export function scheduleRouteSolve(job: RouteSolveJob) {
  if (inFlight) {
    queued = job;
    return;
  }
  inFlight = job;
  try {
    const encoded = encodeRouteSolveJob(job);
    getWorker().postMessage(encoded, [encoded.endpoints.buffer]);
  } catch (error) {
    console.error("route worker failed to start; routing on the main thread", error);
    workerBroken = true;
    inFlight = undefined;
    sink?.(runRouteSolveJob(job));
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./grid-route.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<RouteSolveResult | { error: string }>) => {
      inFlight = undefined;
      if ("routes" in event.data) {
        lastSolveDurationMs = event.data.solveMs;
        sink?.(event.data);
      } else {
        console.error("route worker error:", event.data.error);
      }
      if (queued) {
        const next = queued;
        queued = undefined;
        scheduleRouteSolve(next);
      }
    };
    worker.onerror = (event) => {
      // A worker that cannot run its script would leave every wire on its
      // old route forever; finish the outstanding job here instead.
      console.error("route worker broke; routing on the main thread", event.message);
      workerBroken = true;
      const retry = queued ?? inFlight;
      inFlight = undefined;
      queued = undefined;
      if (retry) {
        sink?.(runRouteSolveJob(retry));
      }
    };
  }
  return worker;
}
