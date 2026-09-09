/**
 * Geometry of finished wires, independent of routing occupancy and costs:
 * where they cross, how long they are, how often they bend - and the
 * POINTS a board scores (Jack, 2026-09-08): crossings first, then every
 * wire priced the way the router prices it, length plus what its bends
 * cost. A wire that got there in one straight run scores its length; one
 * that zig-zagged pays for every bend.
 */
export interface RoutePoint {
  x: number;
  y: number;
}
export interface MeasuredRoute {
  edgeId: string;
  points: readonly RoutePoint[];
  /** Stroke the wire routes at, in px; sets its weight (see wireWeight). */
  width?: number;
}

/**
 * A wire's WEIGHT from its width (Jack, 2026-09-08: "edges with more
 * items/s or L/s are more expensive to traverse"). Widths come off the
 * lane-fraction menu, 4 px for the quietest wire on the board to 16 px
 * for the busiest; a quiet wire weighs 1, the busiest 2.5. Its length and
 * bends count that many times over in the points, and a crossing weighs
 * the heavier of the two wires - so the arrange keeps the trunk lines
 * short and straight and lets the trickles go round.
 */
export function wireWeight(width: number | undefined): number {
  return 0.5 + (width ?? 4) / 8;
}
export interface RouteCrossing {
  point: RoutePoint;
  edges: [string, string];
}
export interface RouteMeasure {
  crossings: number;
  length: number;
  /** Bends of about 45°, about 90°, and sharper (reversals), over all wires. */
  bends45: number;
  bends90: number;
  bendsSharp: number;
  events: RouteCrossing[];
  /** The same four, each wire's counted wireWeight times over. */
  weightedCrossings: number;
  weightedLength: number;
  weightedBends45: number;
  weightedBends90: number;
  weightedBendsSharp: number;
}
/** What a bend and a crossing cost, in pixels of wire: the router's own dials. */
export interface RoutePrices {
  turn45: number;
  turn90: number;
  crossing: number;
}
const EPS = 1e-6;

function raysAt(points: readonly RoutePoint[], p: RoutePoint): number[] {
  const rays: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length < EPS || Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) > EPS * length) continue;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
    if (t < -EPS || t > 1 + EPS) continue;
    for (const q of [a, b]) {
      if (Math.hypot(q.x - p.x, q.y - p.y) < EPS) continue;
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      if (!rays.some((r) => Math.abs(Math.atan2(Math.sin(r - angle), Math.cos(r - angle))) < EPS))
        rays.push(angle);
    }
  }
  return rays;
}

/** Four outgoing rays must alternate. A tangency, shared dock or overlap does not cross. */
function pathsCrossAt(a: MeasuredRoute, b: MeasuredRoute, p: RoutePoint): boolean {
  const ar = raysAt(a.points, p),
    br = raysAt(b.points, p);
  if (ar.length !== 2 || br.length !== 2) return false;
  const rays = [
    ...ar.map((angle) => ({ angle, owner: 0 })),
    ...br.map((angle) => ({ angle, owner: 1 })),
  ].sort((a, b) => a.angle - b.angle);
  return rays.every((r, i) => {
    const next = rays[(i + 1) % 4];
    return (
      r.owner !== next.owner &&
      Math.abs(Math.atan2(Math.sin(r.angle - next.angle), Math.cos(r.angle - next.angle))) > EPS
    );
  });
}

/** The bends along one route: 45°, 90°, and sharper. */
export function countBends(points: readonly RoutePoint[]): { bends45: number; bends90: number; bendsSharp: number } {
  let bends45 = 0;
  let bends90 = 0;
  let bendsSharp = 0;
  let previous: { dx: number; dy: number } | undefined;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    const direction = { dx: dx / length, dy: dy / length };
    if (previous) {
      const cos = previous.dx * direction.dx + previous.dy * direction.dy;
      if (cos < 0.99) {
        if (cos > 0.5) bends45 += 1;
        else if (cos > -0.5) bends90 += 1;
        else bendsSharp += 1;
      }
    }
    previous = direction;
  }
  return { bends45, bends90, bendsSharp };
}

export function measureWireRoutes(input: Iterable<MeasuredRoute>): RouteMeasure {
  const routes = [...input];
  const segments = routes.map((r) =>
    r.points.slice(1).map((b, i) => {
      const a = r.points[i];
      return {
        a,
        b,
        dx: b.x - a.x,
        dy: b.y - a.y,
        left: Math.min(a.x, b.x),
        right: Math.max(a.x, b.x),
        top: Math.min(a.y, b.y),
        bottom: Math.max(a.y, b.y),
      };
    }),
  );
  const weights = routes.map((r) => wireWeight(r.width));
  let length = 0;
  let weightedLength = 0;
  segments.forEach((list, index) => {
    for (const s of list) {
      const run = Math.hypot(s.dx, s.dy);
      length += run;
      weightedLength += run * weights[index];
    }
  });
  let bends45 = 0;
  let bends90 = 0;
  let bendsSharp = 0;
  let weightedBends45 = 0;
  let weightedBends90 = 0;
  let weightedBendsSharp = 0;
  routes.forEach((route, index) => {
    const bends = countBends(route.points);
    bends45 += bends.bends45;
    bends90 += bends.bends90;
    bendsSharp += bends.bendsSharp;
    weightedBends45 += bends.bends45 * weights[index];
    weightedBends90 += bends.bends90 * weights[index];
    weightedBendsSharp += bends.bendsSharp * weights[index];
  });
  let weightedCrossings = 0;
  const events: RouteCrossing[] = [];
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++) {
      const contacts: RoutePoint[] = [];
      for (const a of segments[i])
        for (const b of segments[j]) {
          if (
            a.right < b.left - EPS ||
            b.right < a.left - EPS ||
            a.bottom < b.top - EPS ||
            b.bottom < a.top - EPS
          )
            continue;
          const den = a.dx * b.dy - a.dy * b.dx;
          if (Math.abs(den) < EPS * Math.hypot(a.dx, a.dy) * Math.hypot(b.dx, b.dy) || den === 0)
            continue;
          const wx = b.a.x - a.a.x,
            wy = b.a.y - a.a.y;
          const t = (wx * b.dy - wy * b.dx) / den,
            u = (wx * a.dy - wy * a.dx) / den;
          if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
          const p = { x: a.a.x + t * a.dx, y: a.a.y + t * a.dy };
          if (!contacts.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < EPS)) contacts.push(p);
        }
      for (const p of contacts)
        if (pathsCrossAt(routes[i], routes[j], p)) {
          events.push({ point: p, edges: [routes[i].edgeId, routes[j].edgeId] });
          weightedCrossings += Math.max(weights[i], weights[j]);
        }
    }
  return {
    crossings: events.length,
    length,
    bends45,
    bends90,
    bendsSharp,
    events,
    weightedCrossings,
    weightedLength,
    weightedBends45,
    weightedBends90,
    weightedBendsSharp,
  };
}

/**
 * The board's points: every wire's length plus its bends at the router's
 * prices (a sharper bend as three 90° ones), plus every crossing - each
 * counted the wire's weight times over, so a trunk line's detour costs
 * more than a trickle's. One number, lower is better.
 */
export function routePoints(measure: RouteMeasure, prices: RoutePrices): number {
  return (
    measure.weightedLength +
    measure.weightedBends45 * prices.turn45 +
    (measure.weightedBends90 + 3 * measure.weightedBendsSharp) * prices.turn90 +
    measure.weightedCrossings * prices.crossing
  );
}
