import { calculateThroughput } from "@/lib/solver";
import type { FactoryProject, ThroughputResult } from "@/lib/model/types";

/**
 * The store's one door to the solver, sized to the board it is asked about.
 *
 * A small board solves synchronously, exactly as every call site always has:
 * the result is back before the state update lands and nothing about the
 * store's behaviour changes. A BIG board must not run on the main thread -
 * a several-hundred-machine plan takes seconds to minutes there, and that
 * solve used to run on every edit and every tab switch, which is the
 * "switching tabs freezes the browser" report. Past `SYNC_SOLVE_LIMIT` the
 * solve moves to a Web Worker: the caller gets its previous books back
 * immediately, flagged `stale`, and the real result replaces `lastResult`
 * through the sink when the worker lands.
 *
 * Finished big-board books are kept in a small content-keyed LRU, so
 * switching tabs between unchanged big plans is instant - the design store
 * re-reads a plan from IndexedDB on every switch, which is why the cache
 * cannot key on object identity.
 *
 * Rapid edits coalesce: one solve runs at a time, only the newest waiting
 * plan is kept, and a result that comes back for a plan no longer on the
 * canvas is cached but never shown. Environments without workers (SSR,
 * vitest, old browsers) keep the synchronous path for every size.
 */

/**
 * Nodes plus edges above which the solve leaves the main thread. The 86-machine
 * community platline (41 nodes + 96 edges = 137) solves in ~100ms and stays
 * synchronous; the measured wall grows roughly cubically past that (328 nodes
 * = 8s, 656 = 57s), so everything bigger is worker work.
 */
const SYNC_SOLVE_LIMIT = 220;

/**
 * Size is not the whole story: a 59-machine platline with three loose cell
 * wires solves in 3.8s (84% inside the simplex - the hidden Tank each
 * cross-form wire expands into makes the LP much harder) while the same
 * board without them takes 0.27s. Two more reasons to leave the main thread:
 * the LAST solve, wherever it ran, took longer than this budget - a slow
 * board stays async until a fast solve proves otherwise - and a plan
 * carrying cross-form wires past a token size, so that board's very first
 * solve never freezes the tab either.
 */
const SLOW_SOLVE_MS = 150;
const CROSS_FORM_SYNC_LIMIT = 100;

let lastSolveDurationMs: number | undefined;

const BIG_BOOKS_CACHE_LIMIT = 8;
const bigBooksCache = new Map<string, ThroughputResult>();

interface SolveRequest {
  key: string;
  project: FactoryProject;
}

let sink: ((result: ThroughputResult) => void) | undefined;
let worker: Worker | undefined;
let workerBroken = false;
let inFlight: SolveRequest | undefined;
let queued: SolveRequest | undefined;
/** The content key of the plan the canvas currently shows, when it is big. */
let currentKey: string | undefined;
/** The last books handed out, big or small: what a stale placeholder wears. */
let lastBooks: ThroughputResult | undefined;

/** Where finished worker solves land; the factory store registers itself. */
export function registerBooksSink(apply: (result: ThroughputResult) => void) {
  sink = apply;
}

export function solveBooks(project: FactoryProject): ThroughputResult {
  const size = project.nodes.length + project.edges.length;
  const expectSlow =
    size > SYNC_SOLVE_LIMIT ||
    (lastSolveDurationMs !== undefined && lastSolveDurationMs > SLOW_SOLVE_MS) ||
    (size > CROSS_FORM_SYNC_LIMIT && project.edges.some((edge) => edge.crossForm));
  if (!expectSlow || !workerAvailable()) {
    const started = performance.now();
    const result = calculateThroughput(project);
    lastSolveDurationMs = performance.now() - started;
    currentKey = undefined;
    lastBooks = result;
    return result;
  }

  const key = booksContentKey(project);
  currentKey = key;
  const cached = bigBooksCache.get(key);
  if (cached) {
    // LRU bump.
    bigBooksCache.delete(key);
    bigBooksCache.set(key, cached);
    lastBooks = cached;
    return cached;
  }

  scheduleSolve({ key, project });
  // The previous books stand in while the worker runs. After a tab switch
  // they belong to another plan, whose node ids simply miss - the board reads
  // that as empty books until the real ones land, which is the honest state.
  const placeholder: ThroughputResult = lastBooks
    ? { ...lastBooks, stale: true }
    : emptyBooks();
  lastBooks = placeholder;
  return placeholder;
}

/**
 * The plan as the solver sees it. The `view` block is how the board is DRAWN
 * (camera, rate labels, line weights) and never reaches the solver, so it must
 * not invalidate finished books - it is also the one field the design store
 * restamps on every save, which would otherwise defeat the cache entirely.
 */
function booksContentKey(project: FactoryProject): string {
  const { view: _view, ...solved } = project;
  return JSON.stringify(solved);
}

function workerAvailable(): boolean {
  return !workerBroken && typeof Worker !== "undefined";
}

function scheduleSolve(request: SolveRequest) {
  if (inFlight) {
    // Only the newest waiting plan matters; intermediates were superseded.
    queued = request;
    return;
  }
  inFlight = request;
  try {
    getWorker().postMessage({ key: request.key, project: request.project });
  } catch (error) {
    console.error("solve worker failed to start; solving on the main thread", error);
    workerBroken = true;
    inFlight = undefined;
    deliver(request.key, calculateThroughput(request.project));
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./solve-books.worker.ts", import.meta.url));
    worker.onmessage = (
      event: MessageEvent<{
        key: string;
        result?: ThroughputResult;
        error?: string;
        solveMs?: number;
      }>,
    ) => {
      const { key, result, error, solveMs } = event.data;
      inFlight = undefined;
      if (result) {
        if (solveMs !== undefined) {
          lastSolveDurationMs = solveMs;
        }
        deliver(key, result);
      } else {
        console.error("solve worker error:", error);
      }
      if (queued) {
        const next = queued;
        queued = undefined;
        // A queued repeat of what just finished (or of anything already
        // solved) serves from the cache instead of solving twice.
        const cached = bigBooksCache.get(next.key);
        if (cached) {
          if (next.key === currentKey) {
            lastBooks = cached;
            sink?.(cached);
          }
        } else {
          scheduleSolve(next);
        }
      }
    };
    worker.onerror = (event) => {
      // A worker that cannot run its script would fail every solve silently;
      // fall back to the blocking path rather than showing stale books forever.
      console.error("solve worker broke; falling back to main-thread solves", event.message);
      workerBroken = true;
      const retry = queued ?? inFlight;
      inFlight = undefined;
      queued = undefined;
      if (retry) {
        deliver(retry.key, calculateThroughput(retry.project));
      }
    };
  }
  return worker;
}

function deliver(key: string, result: ThroughputResult) {
  bigBooksCache.set(key, result);
  while (bigBooksCache.size > BIG_BOOKS_CACHE_LIMIT) {
    const oldest = bigBooksCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    bigBooksCache.delete(oldest);
  }
  if (key === currentKey) {
    lastBooks = result;
    sink?.(result);
  }
}

function emptyBooks(): ThroughputResult {
  return {
    nodes: {},
    storages: {},
    resources: {},
    edges: {},
    totalEuT: 0,
    totalEuPerSecond: 0,
    bottlenecks: [],
    externalInputs: [],
    unconsumedOutputs: [],
    generatedAt: new Date().toISOString(),
    stale: true,
  };
}
