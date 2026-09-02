import { calculateThroughput } from "@/lib/solver";
import { initLpEngine } from "@/lib/solver/lp-engine";
import type { FactoryProject } from "@/lib/model/types";

// HiGHS loads once at worker startup, and every solve waits for the load to
// settle: a board routed here is slow by definition, so a one-time wasm
// fetch is always the better trade than a minutes-long homegrown walk. A
// failed load resolves too - solves then run on the homegrown simplex.
const engineReady = initLpEngine({ glueUrl: "/highs.js", wasmUrl: "/highs.wasm" });

/**
 * The solver, off the main thread. One message in (a plan and the content key
 * that names it), one message out (the same key and the finished books). The
 * scheduling - coalescing rapid edits, dropping superseded solves, deciding
 * which result is still current - all lives on the store side in
 * `solve-books.ts`; this file stays a dumb calculator on purpose.
 */
self.onmessage = async (event: MessageEvent<{ key: string; project: FactoryProject }>) => {
  const { key, project } = event.data;
  try {
    await engineReady;
    const started = performance.now();
    const result = calculateThroughput(project);
    // The solve's own cost rides back so the router can learn whether this
    // board is one that must stay off the main thread.
    self.postMessage({ key, result, solveMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ key, error: error instanceof Error ? error.message : String(error) });
  }
};
