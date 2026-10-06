import { describe, expect, it } from "vitest";
import { solveGridRoutes, type GridObstacle, type GridRouteRequest } from "./grid-edge-router";
import { DEFAULT_ROUTER_TUNING } from "./router-tuning";
import { decodeRouteSolveJob, encodeRouteSolveJob, runRouteSolveJob } from "./grid-route-job";

function card(id: string, x: number, y: number): GridObstacle {
  return { id, left: x, top: y, right: x + 360, bottom: y + 160 };
}

function routeRequest(
  edgeId: string,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): GridRouteRequest {
  return {
    edgeId,
    order: 0,
    sources: [{ x: sourceX, y: sourceY, side: "right" }],
    targets: [{ x: targetX, y: targetY, side: "left" }],
    strokeWidth: 4,
  };
}

describe("grid route solve jobs", () => {
  it("round-trips pinned routes alongside the requests", () => {
    const obstacles = [card("a", 0, 0), card("b", 600, 0), card("c", 0, 500), card("d", 600, 500)];
    const pinnedRequest = routeRequest("fixed", 360, 60, 600, 60);
    const pinnedRoute = solveGridRoutes(obstacles, [pinnedRequest], undefined, {
      ...DEFAULT_ROUTER_TUNING,
      diagonals: false,
    }).get("fixed")!;
    const job = {
      signature: "sig",
      seq: 2,
      obstacles,
      requests: [routeRequest("move", 360, 560, 600, 560)],
      pinned: [{ request: pinnedRequest, route: pinnedRoute }],
      tuning: { ...DEFAULT_ROUTER_TUNING, diagonals: false },
    };

    const decoded = decodeRouteSolveJob(encodeRouteSolveJob(job));
    expect(decoded.pinned).toEqual(job.pinned);
    expect(decoded.requests).toEqual(job.requests);
  });

  it("returns route metadata so installed paths can be pinned in the next drop", () => {
    const obstacles = [card("a", 0, 0), card("b", 600, 0), card("c", 0, 500), card("d", 600, 500)];
    const request = routeRequest("edge", 360, 60, 600, 60);
    const pinnedRequest = routeRequest("fixed", 360, 560, 600, 560);
    const pinnedRoute = solveGridRoutes(obstacles, [pinnedRequest], undefined, {
      ...DEFAULT_ROUTER_TUNING,
      diagonals: false,
    }).get("fixed")!;
    const result = runRouteSolveJob({
      signature: "sig",
      seq: 1,
      obstacles,
      requests: [request],
      pinned: [{ request: pinnedRequest, route: pinnedRoute }],
      tuning: { ...DEFAULT_ROUTER_TUNING, diagonals: false },
    });

    expect(result.routes[0]?.route).toMatchObject({ edgeId: "edge", vertices: expect.any(Array) });
    expect(result.routes[0]?.points).toEqual(result.routes[0]?.route.points);
    expect(result.pinnedRoutes).toEqual([{ edgeId: "fixed", order: 0 }]);
  });
});
