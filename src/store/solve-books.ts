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
 * community platline (41 nodes + 96 edges = 137) solves in ~100ms on the
 * homegrown simplex and a 118-machine oil board (44 + 104 = 148) in 575ms -
 * each a felt freeze on every edit, while the worker's HiGHS does either in
 * under 50ms. The measured wall grows roughly cubically past that (328
 * nodes = 8s, 656 = 57s), so everything bigger is worker work.
 */
const SYNC_SOLVE_LIMIT = 120;

/**
 * Size is not the whole story: a 59-machine platline with three loose cell
 * wires solves in 3.8s (84% inside the simplex - the hidden Tank each
 * cross-form wire expands into makes the LP much harder) while the same
 * board without them takes 0.27s. Two more reasons to leave the main thread:
 * this plan's last MAIN-THREAD solve took longer than this budget (three
 * frames: past it every edit is a visible stutter, and in Firefox a hang
 * that long clips the board's sounds, see board-sounds.ts), and a plan
 * carrying cross-form wires past a token size, so that board's very first
 * solve never freezes the tab either.
 */
const SLOW_SOLVE_MS = 50;
const CROSS_FORM_SYNC_LIMIT = 100;
/**
 * SOLVE MODE is a different animal on the homegrown simplex: its LP is
 * six dense solves over every machine and wire at once, and pool mode
 * (which rides on solve mode) adds a pool drawer per resource on top.
 * Measured on a 102-card community plan (2026-09-05): plan mode 7s, solve
 * mode 43s, solve plus pool 128s on the simplex - and 0.3s, 44ms and 46ms
 * on HiGHS, which only the worker loads. Nothing that size may run here.
 * Forty nodes-plus-wires is a handful of machines; past it the tab would
 * freeze for as long as the first slow solve took to teach the rule below.
 */
const SOLVE_MODE_SYNC_LIMIT = 40;

/**
 * The last MAIN-THREAD solve's wall time, and the plan it was measured on.
 * Only a synchronous solve may write it: the worker runs HiGHS, roughly ten
 * times faster than the simplex the main thread would run, so its timing
 * says nothing about how long the tab would freeze. It used to count, and
 * a plan whose solve-mode books came back from the worker in 44ms was then
 * solved synchronously on the way back to build mode - 575ms with the tab
 * frozen, on a board that had already proven slow. A slow plan therefore
 * stays with the worker for the session; another plan opened later decides
 * by its own size.
 */
let lastSolveDurationMs: number | undefined;
let lastSolveProjectId: string | undefined;

/**
 * AUTO RECALCULATION (Jack, 2026-09-07). On by default: every edit solves,
 * as it always has. Off, the store's door hands the last books back flagged
 * `held` and remembers nothing else - the project in the store IS the
 * pending plan - until `solveBooksNow` is asked for. A browser preference,
 * never part of the plan, for players whose boards make every edit a wait.
 */
const AUTO_SOLVE_KEY = "gtnh-factory-flow.auto-solve.v1";
let autoSolve = readAutoSolve();
const autoSolveListeners = new Set<() => void>();

function readAutoSolve(): boolean {
  try {
    return typeof localStorage === "undefined" || localStorage.getItem(AUTO_SOLVE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function getAutoSolve(): boolean {
  return autoSolve;
}

export function setAutoSolve(on: boolean): void {
  autoSolve = on;
  try {
    localStorage.setItem(AUTO_SOLVE_KEY, on ? "on" : "off");
  } catch {
    // A private window that refuses storage still gets the session's setting.
  }
  for (const listener of autoSolveListeners) {
    listener();
  }
}

export function subscribeAutoSolve(listener: () => void): () => void {
  autoSolveListeners.add(listener);
  return () => {
    autoSolveListeners.delete(listener);
  };
}

/** The solve the player asked for by hand: the gate does not apply. */
export function solveBooksNow(project: FactoryProject): ThroughputResult {
  return solveBooksUngated(project);
}

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
  if (!autoSolve && lastBooks) {
    // Held, not thinking: the old books stand until the player presses solve.
    const held: ThroughputResult = { ...lastBooks, stale: true, held: true };
    lastBooks = held;
    return held;
  }
  return solveBooksUngated(project);
}

function solveBooksUngated(project: FactoryProject): ThroughputResult {
  const size = project.nodes.length + project.edges.length;
  const provenSlow =
    lastSolveDurationMs !== undefined &&
    lastSolveDurationMs > SLOW_SOLVE_MS &&
    lastSolveProjectId === project.id;
  const expectSlow =
    size > SYNC_SOLVE_LIMIT ||
    provenSlow ||
    (size > CROSS_FORM_SYNC_LIMIT && project.edges.some((edge) => edge.crossForm)) ||
    ((project.solveMode === true || project.poolMode === true) && size > SOLVE_MODE_SYNC_LIMIT);
  if (!expectSlow || !workerAvailable()) {
    const started = performance.now();
    const result = calculateThroughput(project);
    lastSolveDurationMs = performance.now() - started;
    lastSolveProjectId = project.id;
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
      const { key, result, error } = event.data;
      inFlight = undefined;
      if (result) {
        // `solveMs` is deliberately not read: see lastSolveDurationMs.
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
