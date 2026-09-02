import {
  solveGridRoutes,
  type GridEndpoint,
  type GridObstacle,
  type GridPoint,
  type GridRouteRequest,
  type GridSide,
} from "./grid-edge-router";

/**
 * The route solve JOB: what a solve is, how it crosses to the worker and
 * back (encode/decode), and how it runs. Pure and worker-safe, and
 * deliberately in its own file: this is everything `grid-route.worker.ts`
 * needs, and it must not import `grid-route-solve.ts`, which is the module
 * that SPAWNS the worker. When the worker's own bundle reached back into
 * that module, the bundle referenced itself and Turbopack's production
 * compile never finished - the v2.50.2 deploy sat at "Creating an optimized
 * production build" for twenty minutes on two machines. The solver worker
 * (`solve-books.worker.ts`) never had the loop because it imports the solver,
 * not the scheduler; this file gives the router the same shape.
 */


/** Boards past this many wires route in the worker instead of in render. */
export const ASYNC_ROUTE_EDGE_LIMIT = 60;

export interface RouteSolveJob {
  /** The board's own routing signature, echoed back with the answer. */
  signature: string;
  /** Monotonic; a result for a lower number than the last install is stale. */
  seq: number;
  obstacles: GridObstacle[];
  requests: GridRouteRequest[];
}

export interface RouteSolveResult {
  signature: string;
  seq: number;
  routes: Array<{ edgeId: string; order: number; points: GridPoint[] }>;
  solveMs: number;
}

/**
 * The job on the wire. Every request carries the whole perimeter of both
 * its cards as candidate docks - fifty-odd endpoints per wire, so a big
 * board is a hundred thousand small objects, and structured-cloning those
 * costs the main thread more than the solve is worth. Endpoints ride as one
 * flat Float64Array instead (five numbers each), which transfers in
 * constant time; everything else is small and clones as it is.
 */
export interface EncodedRouteSolveJob {
  signature: string;
  seq: number;
  obstacles: GridObstacle[];
  edges: Array<{
    edgeId: string;
    order: number;
    strokeWidth: number;
    sourceCount: number;
    targetCount: number;
    waypoints?: GridPoint[];
    exemptObstacleIds?: readonly string[];
    homeObstacleIds?: readonly string[];
  }>;
  endpoints: Float64Array;
}

const SIDES: readonly GridSide[] = ["left", "right", "top", "bottom"];
const ENDPOINT_STRIDE = 5;

export function encodeRouteSolveJob(job: RouteSolveJob): EncodedRouteSolveJob {
  let count = 0;
  for (const request of job.requests) {
    count += request.sources.length + request.targets.length;
  }
  const endpoints = new Float64Array(count * ENDPOINT_STRIDE);
  let offset = 0;
  const write = (endpoint: GridEndpoint) => {
    endpoints[offset] = endpoint.x;
    endpoints[offset + 1] = endpoint.y;
    endpoints[offset + 2] = SIDES.indexOf(endpoint.side);
    endpoints[offset + 3] = endpoint.penalty ?? Number.NaN;
    endpoints[offset + 4] = endpoint.stubDepth ?? Number.NaN;
    offset += ENDPOINT_STRIDE;
  };
  const edges: EncodedRouteSolveJob["edges"] = [];
  for (const request of job.requests) {
    for (const endpoint of request.sources) {
      write(endpoint);
    }
    for (const endpoint of request.targets) {
      write(endpoint);
    }
    edges.push({
      edgeId: request.edgeId,
      order: request.order,
      strokeWidth: request.strokeWidth,
      sourceCount: request.sources.length,
      targetCount: request.targets.length,
      waypoints: request.waypoints,
      exemptObstacleIds: request.exemptObstacleIds,
      homeObstacleIds: request.homeObstacleIds,
    });
  }
  return { signature: job.signature, seq: job.seq, obstacles: job.obstacles, edges, endpoints };
}

export function decodeRouteSolveJob(encoded: EncodedRouteSolveJob): RouteSolveJob {
  const { endpoints } = encoded;
  let offset = 0;
  const read = (): GridEndpoint => {
    const endpoint: GridEndpoint = {
      x: endpoints[offset],
      y: endpoints[offset + 1],
      side: SIDES[endpoints[offset + 2]] ?? "left",
    };
    const penalty = endpoints[offset + 3];
    if (!Number.isNaN(penalty)) {
      endpoint.penalty = penalty;
    }
    const stubDepth = endpoints[offset + 4];
    if (!Number.isNaN(stubDepth)) {
      endpoint.stubDepth = stubDepth;
    }
    offset += ENDPOINT_STRIDE;
    return endpoint;
  };
  const requests: GridRouteRequest[] = encoded.edges.map((edge) => {
    const sources: GridEndpoint[] = [];
    for (let i = 0; i < edge.sourceCount; i += 1) {
      sources.push(read());
    }
    const targets: GridEndpoint[] = [];
    for (let i = 0; i < edge.targetCount; i += 1) {
      targets.push(read());
    }
    return {
      edgeId: edge.edgeId,
      order: edge.order,
      sources,
      targets,
      strokeWidth: edge.strokeWidth,
      waypoints: edge.waypoints,
      exemptObstacleIds: edge.exemptObstacleIds,
      homeObstacleIds: edge.homeObstacleIds,
    };
  });
  return {
    signature: encoded.signature,
    seq: encoded.seq,
    obstacles: encoded.obstacles,
    requests,
  };
}

/** Runs the job right here; the worker and the fallback both call this. */
export function runRouteSolveJob(job: RouteSolveJob): RouteSolveResult {
  const started = performance.now();
  const solved = solveGridRoutes(job.obstacles, job.requests);
  const orderByEdge = new Map(job.requests.map((request) => [request.edgeId, request.order]));
  const routes: RouteSolveResult["routes"] = [];
  for (const [edgeId, routed] of solved) {
    routes.push({ edgeId, order: orderByEdge.get(edgeId) ?? 0, points: routed.points });
  }
  return { signature: job.signature, seq: job.seq, routes, solveMs: performance.now() - started };
}
