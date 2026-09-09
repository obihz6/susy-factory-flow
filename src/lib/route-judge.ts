/**
 * The layout judge: routes a board's real wires at hypothetical card
 * positions and reports crossings and length (`board-arrange`'s judge).
 *
 * A full verdict solves every wire. A QUICK verdict, asked with the
 * positions it differs from (`base`), reuses the base's routes for every
 * wire that neither touches a moved card nor runs through where one now
 * stands, pins them, and re-solves only the rest - the polish tries dozens
 * of one-card moves, and each costs a fraction of a solve this way. Full
 * verdicts are cached by their positions so a base is found by identity of
 * layout, not of Map.
 */

import {
  measureRoutes,
  solveGridRoutes,
  type GridEndpoint,
  type GridObstacle,
  type GridRoutedEdge,
  type GridRouteRequest,
  type PinnedRoute,
} from "@/components/flow/grid-edge-router";
import { BOARD_GRID } from "@/lib/board-grid";
import { routePoints } from "@/lib/route-metrics";
import { DEFAULT_ROUTER_TUNING, type RouterTuning } from "@/components/flow/router-tuning";

export type JudgePositions = ReadonlyMap<string, { x: number; y: number }>;

export interface JudgeVerdict {
  crossings: number;
  length: number;
  /** Length plus bends and crossings at the router's prices: the score. */
  points: number;
  events: Array<{ point: { x: number; y: number }; edges: [string, string] }>;
}

/** What the judges have done so far, for benches. */
export const judgeStats = { full: 0, fullMs: 0, quick: 0, quickMs: 0, loose: 0, pinned: 0, prepMs: 0, verdictMs: 0 };

export function makeRouteJudge(
  restingObstacles: readonly GridObstacle[],
  restingRequests: readonly GridRouteRequest[],
  tuningIn: Partial<RouterTuning>,
): (positions: JudgePositions, options?: { quick?: boolean; base?: JudgePositions }) => JudgeVerdict {
  // A tuning saved before a dial existed still routes with that dial at
  // its default, exactly as the app fills it in.
  const tuning: RouterTuning = { ...DEFAULT_ROUTER_TUNING, ...tuningIn };
  const quickTuning: RouterTuning = {
    ...tuning,
    negotiationRounds: 1,
    negotiationBudget: 0.5,
    wideRungCells: Math.min(tuning.wideRungCells, 12),
  };
  const fullByKey = new Map<string, { obstacles: GridObstacle[]; requests: GridRouteRequest[]; routes: Map<string, GridRoutedEdge> }>();
  const keyOf = (positions: JudgePositions) =>
    restingObstacles.map((o) => {
      const p = positions.get(o.id);
      return p ? `${p.x},${p.y}` : `${o.left},${o.top}`;
    }).join(";");
  const place = (positions: JudgePositions) => {
    const delta = new Map<string, { dx: number; dy: number }>();
    const obstacles: GridObstacle[] = restingObstacles.map((o) => {
      const p = positions.get(o.id) ?? { x: o.left, y: o.top };
      delta.set(o.id, { dx: p.x - o.left, dy: p.y - o.top });
      return { id: o.id, left: p.x, top: p.y, right: p.x + (o.right - o.left), bottom: p.y + (o.bottom - o.top) };
    });
    const shift = (ends: GridEndpoint[], id: string): GridEndpoint[] => {
      const d = delta.get(id) ?? { dx: 0, dy: 0 };
      return ends.map((e) => ({ ...e, x: e.x + d.dx, y: e.y + d.dy }));
    };
    const requests: GridRouteRequest[] = restingRequests.map((r) => ({
      ...r,
      sources: shift(r.sources, r.sourceCardId ?? ""),
      targets: shift(r.targets, r.targetCardId ?? ""),
      waypoints: undefined,
    }));
    return { obstacles, requests };
  };
  const verdict = (routes: Iterable<GridRoutedEdge>): JudgeVerdict => {
    const started = performance.now();
    const measure = measureRoutes(routes);
    judgeStats.verdictMs += performance.now() - started;
    return { ...measure, points: routePoints(measure, tuning) };
  };
  const full = (positions: JudgePositions): JudgeVerdict => {
    const key = keyOf(positions);
    const cached = fullByKey.get(key);
    if (cached) {
      return verdict(cached.routes.values());
    }
    const { obstacles, requests } = place(positions);
    const started = performance.now();
    const routes = solveGridRoutes(obstacles, requests, undefined, tuning);
    judgeStats.full += 1;
    judgeStats.fullMs += performance.now() - started;
    fullByKey.set(key, { obstacles, requests, routes });
    if (fullByKey.size > 64) {
      fullByKey.delete(fullByKey.keys().next().value!);
    }
    return verdict(routes.values());
  };
  return (positions, options) => {
    if (!options?.quick || !options.base) {
      return full(positions);
    }
    const base = fullByKey.get(keyOf(options.base));
    if (!base) {
      return full(positions);
    }
    const prepStarted = performance.now();
    // Which cards moved between the base and this layout?
    const moved = new Set<string>();
    for (const o of restingObstacles) {
      const a = options.base.get(o.id) ?? { x: o.left, y: o.top };
      const b = positions.get(o.id) ?? { x: o.left, y: o.top };
      if (a.x !== b.x || a.y !== b.y) moved.add(o.id);
    }
    if (moved.size === 0) {
      return verdict(base.routes.values());
    }
    const { obstacles, requests } = place(positions);
    const movedRects = obstacles.filter((o) => moved.has(o.id)).map((o) => ({
      left: o.left - BOARD_GRID,
      top: o.top - BOARD_GRID,
      right: o.right + BOARD_GRID,
      bottom: o.bottom + BOARD_GRID,
    }));
    const runsThroughMoved = (route: GridRoutedEdge): boolean => {
      for (let i = 1; i < route.points.length; i += 1) {
        const a = route.points[i - 1];
        const b = route.points[i];
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const bottom = Math.max(a.y, b.y);
        for (const rect of movedRects) {
          if (right > rect.left && left < rect.right && bottom > rect.top && top < rect.bottom) return true;
        }
      }
      return false;
    };
    const pinned: PinnedRoute[] = [];
    const loose: GridRouteRequest[] = [];
    const baseRequests = new Map(base.requests.map((r) => [r.edgeId, r]));
    for (const request of requests) {
      const route = base.routes.get(request.edgeId);
      const touches = moved.has(request.sourceCardId ?? "") || moved.has(request.targetCardId ?? "");
      if (!route || touches || !route.vertices || runsThroughMoved(route)) {
        loose.push(request);
      } else {
        pinned.push({ request: baseRequests.get(request.edgeId) ?? request, route });
      }
    }
    judgeStats.prepMs += performance.now() - prepStarted;
    const started = performance.now();
    // The loose wires negotiate briefly: the pinned ones cannot yield, so
    // long rounds only re-fight the same crossings.
    const routes = solveGridRoutes(obstacles, loose, undefined, quickTuning, pinned);
    judgeStats.quick += 1;
    judgeStats.quickMs += performance.now() - started;
    judgeStats.loose += loose.length;
    judgeStats.pinned += pinned.length;
    return verdict(routes.values());
  };
}
