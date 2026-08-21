/**
 * The grid edge router.
 *
 * Wires live on the same 20px grid the cards are built from (`board-grid.ts`):
 * every straight run of every wire travels along a grid line, and no run ever
 * comes within one cell of a card. The one sanctioned exception is the port
 * stub — the last hop from a card's margin to the port itself, which by
 * definition has to cross the margin.
 *
 * A grid line is a LANE with 16 usable pixels of width. Wires are fractions
 * of a lane (a full pipe is 16px, never the whole 20 — two full pipes in
 * neighbouring lanes keep 4px of daylight), and wires whose fractions fit
 * side by side SHARE the lane: a ¼ wire and a ½ wire ride the same line with
 * a 2px gap between them, packed around the line's centre. The A* cost makes
 * riding an occupied-but-not-full lane slightly CHEAPER than an empty one, so
 * wires heading the same way find each other, travel together as a ribbon,
 * and peel off near their destinations. A full lane costs heavily instead,
 * which pushes latecomers into the next line over — overlap is never chosen
 * while any separated path exists. Only the port stubs may stack, because
 * arbitrarily many wires can meet one port and a port row is one lane tall.
 *
 * Everything here is a pure function of its inputs: flow-space geometry in,
 * polylines out. No DOM, no React, no viewport — the same inputs give the
 * same routes at every zoom, which is the routing invariant ARCHITECTURE.md
 * demands. The host feeds it published geometry and caches the result by
 * content fingerprint.
 */

import { BOARD_GRID } from "@/lib/board-grid";

/** One cell of clearance between any wire run and any card. */
export const WIRE_NODE_MARGIN = BOARD_GRID;

/** Usable stroke pixels inside one lane; the rest is guaranteed daylight. */
export const LANE_CAPACITY = 16;

/** Breathing room between two wires sharing a lane. */
export const LANE_GAP = 2;

/**
 * The widths wires are allowed to draw at: fractions of a lane, bottoming
 * out at ¼ (4px) — anything thinner read as a scratch, not a wire. Eight
 * steps rather than four: the heat scale already blends rank with log
 * magnitude so 5k vs 10k stays distinguishable even with 100k on the
 * board, and a coarse menu was throwing that resolution away at the last
 * moment.
 */
export const LANE_FRACTIONS = [
  1 / 4,
  5 / 16,
  3 / 8,
  7 / 16,
  1 / 2,
  5 / 8,
  3 / 4,
  1,
] as const;

/**
 * Normalized flow heat (0..1) → the stroke width for dynamic-width mode.
 * Heat maps onto the menu by INDEX, evenly, so every step gets an equal
 * slice of the scale — thresholding by fraction value clustered most of
 * the range onto the widest steps.
 */
export function laneWidthForHeat(heat: number): number {
  const clamped = Math.min(Math.max(heat, 0), 1);
  const fraction = LANE_FRACTIONS[Math.round(clamped * (LANE_FRACTIONS.length - 1))];
  return Math.round(fraction * LANE_CAPACITY * 100) / 100;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridObstacle {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type GridSide = "left" | "right" | "top" | "bottom";

/**
 * One place a wire may start or end: the true anchor (on the card border, or
 * a few pixels inside at a coupling) plus which side of the card it faces.
 */
export interface GridEndpoint {
  x: number;
  y: number;
  side: GridSide;
  /**
   * Extra cost for choosing this dock, in pixel-equivalents. The host uses
   * it for the centre bias: docks near the middle of a side are free, docks
   * out toward the corners pay — so a wire attaches near-centre whenever
   * that costs less than the penalty, including taking a turn to do it.
   */
  penalty?: number;
  /**
   * How much further INTO the card the drawn wire continues past the
   * routing anchor, along the side's inward normal. The recipe card's
   * machine tab zone is part of the routed box (wires keep their one-cell
   * clearance over the tabs) but its top edge is phantom — the painted
   * window starts lower. Routing math (aprons, lane graph, dock claims)
   * stays on the anchor; only the final drawn stub crosses the zone and
   * lands on the card's true edge.
   */
  stubDepth?: number;
}

export interface GridRouteRequest {
  edgeId: string;
  /** Deterministic priority: lower routes first and claims lanes first. */
  order: number;
  /** Candidate endpoints; the router picks the pair that routes cheapest. */
  sources: GridEndpoint[];
  targets: GridEndpoint[];
  /** Stroke this wire draws at, in px. Must be ≤ LANE_CAPACITY. */
  strokeWidth: number;
  /**
   * User-pinned stops, in order: the wire routes source → each waypoint →
   * target. Unreachable stops (dragged inside a card's margin) make the
   * route fall back to ignoring them rather than failing.
   */
  waypoints?: GridPoint[];
  /**
   * Obstacles THIS wire is allowed to pass through: the open board frames
   * its endpoints live inside. A wire into a board member has to cross that
   * board's border somewhere, so the frame cannot block it — while every
   * frame the wire has no business in stays as solid as a card.
   */
  exemptObstacleIds?: readonly string[];
  /**
   * The frames holding BOTH of this wire's ends — the rooms it lives in.
   * A wire between two cards on the same board has no business leaving it,
   * so wandering outside these costs (`COST_OUTSIDE_HOME`), while the
   * frames it is only passing OUT of charge for loitering instead. Always
   * a subset of `exemptObstacleIds`.
   */
  homeObstacleIds?: readonly string[];
}

export interface GridRoutedEdge {
  edgeId: string;
  points: GridPoint[];
}

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** Cost per pixel on an empty lane. */
const COST_EMPTY = 1;
/**
 * Cost per pixel on a lane that already carries wires this one FITS beside.
 * ABOVE the empty cost on purpose: travelling together means the next lane
 * over (20px apart — still reads as a ribbon), not riding 2px off another
 * wire's shoulder. Squeezing into an occupied lane is what a wire does when
 * the free lanes nearby are blocked or long detours, not its first choice.
 */
const COST_SHARED = 1.3;
/**
 * Cost per pixel on a lane this wire does NOT fit into. High enough that any
 * one-lane detour (two turns + a cell over and back) beats overlapping for
 * more than a couple of cells, low enough that a wire boxed in on every side
 * still routes instead of failing.
 */
const COST_OVERFLOW = 6;
/**
 * Cost per pixel spent inside a board frame this wire is on its way OUT of.
 *
 * A wire with one end in a board has to cross that border, but it should
 * cross it and be gone: left at the plain rate it would happily run the
 * length of the frame's own edge line (an empty lane like any other) before
 * turning out, which draws the wire along the board's rim and reads as the
 * board leaking. At this rate the shortest way out always beats the scenic
 * one.
 */
const COST_INSIDE_EXEMPT = 3;
/**
 * Cost per pixel spent OUTSIDE a frame that holds both of this wire's ends.
 *
 * The mirror of the rule above, and the reason it needs one: a wire between
 * two cards on the same board pays the leaving-rate on the stretch inside
 * but nothing out in the open, so it would duck out of the board and come
 * back in — which is precisely the thing a board is drawn to say does not
 * happen. Inside its own room the wire travels at the plain rate; stepping
 * out costs, so it only does that when the room leaves it no path at all.
 */
const COST_OUTSIDE_HOME = 3;
/** Cost of one 90° turn, in pixel-equivalents. */
const TURN_COST = 30;
/** A* gives up after this many pops and the caller falls back. */
const MAX_ASTAR_POPS = 40_000;
/** Search-window padding around the endpoints, then the growth factor. */
const WINDOW_PAD = 400;
const WINDOW_GROWTH = 4;

/* ------------------------------------------------------------------ */
/* Occupancy: who is already riding which stretch of which line        */
/* ------------------------------------------------------------------ */

interface LaneClaim {
  lo: number;
  hi: number;
}

/**
 * Claims are tracked per CELL of a line (each 20px stretch), because two
 * wires can share a line for part of its length and part company later —
 * capacity is a property of a stretch, not of the whole line.
 */
class LaneOccupancy {
  private cells = new Map<string, LaneClaim[]>();

  private key(axis: "h" | "v", line: number, cell: number): string {
    return `${axis}:${line}:${cell}`;
  }

  claimsFor(axis: "h" | "v", line: number, from: number, to: number): LaneClaim[] {
    // Inclusive at aligned ends (floor, not ceil-1): two runs that MEET at a
    // grid vertex share that boundary cell, so a run rejoining a line right
    // where another ends packs beside it instead of re-centring onto it.
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.floor(Math.max(from, to) / BOARD_GRID);
    const merged: LaneClaim[] = [];
    for (let cell = lo; cell <= hi; cell += 1) {
      const claims = this.cells.get(this.key(axis, line, cell));
      if (claims) {
        merged.push(...claims);
      }
    }
    return merged;
  }

  /** Total stroke already claimed on the busiest cell of the stretch. */
  usedWidth(axis: "h" | "v", line: number, from: number, to: number): number {
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.floor(Math.max(from, to) / BOARD_GRID);
    let worst = 0;
    for (let cell = lo; cell <= hi; cell += 1) {
      const claims = this.cells.get(this.key(axis, line, cell));
      if (!claims) {
        continue;
      }
      let total = 0;
      for (const claim of claims) {
        total += claim.hi - claim.lo;
      }
      if (total > worst) {
        worst = total;
      }
    }
    return worst;
  }

  claim(axis: "h" | "v", line: number, from: number, to: number, claimInterval: LaneClaim) {
    const lo = Math.floor(Math.min(from, to) / BOARD_GRID);
    const hi = Math.floor(Math.max(from, to) / BOARD_GRID);
    for (let cell = lo; cell <= hi; cell += 1) {
      const key = this.key(axis, line, cell);
      const claims = this.cells.get(key);
      if (claims) {
        claims.push(claimInterval);
      } else {
        this.cells.set(key, [claimInterval]);
      }
    }
  }
}

/**
 * Where in the lane a new wire of `width` sits, given what is already there.
 * A lone wire rides dead centre. A joiner slots beside the existing claims —
 * on the side of its own upcoming turn when it has one (`prefer` −1/+1), so
 * a wire about to peel off leftward sits on the left of the bundle and never
 * has to cross its lane-mates to leave. A wire that fits nowhere returns
 * centre again — that is the sanctioned port-stub overlap, and the A* cost
 * has already made sure it only happens where there was no alternative.
 */
function packIntoLane(existing: LaneClaim[], width: number, prefer: number): LaneClaim {
  const half = LANE_CAPACITY / 2;
  const tryAt = (center: number): LaneClaim | undefined => {
    const lo = center - width / 2;
    const hi = center + width / 2;
    if (lo < -half - 1e-6 || hi > half + 1e-6) {
      return undefined;
    }
    for (const claim of existing) {
      if (lo < claim.hi + LANE_GAP - 1e-6 && hi > claim.lo - LANE_GAP + 1e-6) {
        return undefined;
      }
    }
    return { lo, hi };
  };

  const candidates: number[] = [0];
  for (const claim of existing) {
    candidates.push(claim.hi + LANE_GAP + width / 2);
    candidates.push(claim.lo - LANE_GAP - width / 2);
  }
  candidates.sort((left, right) =>
    prefer !== 0
      ? // Toward the exit side first; nearest the centre among equals.
        prefer * (right - left) || Math.abs(left) - Math.abs(right)
      : Math.abs(left) - Math.abs(right) || left - right,
  );
  for (const center of candidates) {
    const slot = tryAt(center);
    if (slot) {
      return slot;
    }
  }
  // Nothing fits inside the band — a fat pipe beside a fat pipe, or a
  // stroke doubling back on itself. Spill past the band edge rather than
  // returning centre: centre meant drawing EXACTLY on top of whatever is
  // already there, which is the one thing a wire must never do to itself.
  // The spill leans on the lane's daylight (and a sliver of the neighbour
  // lane at worst), which still reads as two lines.
  const trySpill = (center: number): LaneClaim | undefined => {
    const lo = center - width / 2;
    const hi = center + width / 2;
    for (const claim of existing) {
      if (lo < claim.hi + LANE_GAP - 1e-6 && hi > claim.lo - LANE_GAP + 1e-6) {
        return undefined;
      }
    }
    return { lo, hi };
  };
  for (const center of candidates) {
    const slot = trySpill(center);
    if (slot) {
      return slot;
    }
  }
  return { lo: -width / 2, hi: width / 2 };
}

/* ------------------------------------------------------------------ */
/* The line graph                                                      */
/* ------------------------------------------------------------------ */

function snapLine(value: number): number {
  return Math.round(value / BOARD_GRID) * BOARD_GRID;
}

/** Sorted unique array plus index lookup. */
function buildAxis(values: Iterable<number>): { coords: number[]; index: Map<number, number> } {
  const coords = [...new Set(values)].sort((left, right) => left - right);
  const index = new Map<number, number>();
  coords.forEach((coord, i) => index.set(coord, i));
  return { coords, index };
}

interface BlockedIntervals {
  /** Per line index: sorted merged [lo, hi] intervals a run may not overlap. */
  byLine: Array<Array<[number, number]>>;
}

function buildBlocked(
  lineCoords: number[],
  obstacles: GridObstacle[],
  pickSpan: (obstacle: GridObstacle) => [number, number],
  pickBlock: (obstacle: GridObstacle) => [number, number],
): BlockedIntervals {
  const byLine: Array<Array<[number, number]>> = lineCoords.map(() => []);
  for (const obstacle of obstacles) {
    const [spanLo, spanHi] = pickSpan(obstacle);
    const [blockLo, blockHi] = pickBlock(obstacle);
    // Lines STRICTLY inside the margin-inflated span are blocked; the
    // boundary lines are exactly one cell out and stay legal.
    let lo = binarySearchAbove(lineCoords, spanLo - WIRE_NODE_MARGIN);
    for (; lo < lineCoords.length && lineCoords[lo] < spanHi + WIRE_NODE_MARGIN; lo += 1) {
      byLine[lo].push([blockLo - WIRE_NODE_MARGIN, blockHi + WIRE_NODE_MARGIN]);
    }
  }
  for (const intervals of byLine) {
    intervals.sort((left, right) => left[0] - right[0]);
  }
  return { byLine };
}

/** First index whose coord is strictly greater than `value`. */
function binarySearchAbove(coords: number[], value: number): number {
  let lo = 0;
  let hi = coords.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (coords[mid] <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** May a run travel [from, to] on this line without entering a margin? */
function runIsFree(intervals: Array<[number, number]>, from: number, to: number): boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (const [blockLo, blockHi] of intervals) {
    if (blockLo >= hi) {
      break;
    }
    // Open-interval overlap: touching a margin boundary is allowed,
    // entering it is not.
    if (hi > blockLo + 1e-6 && lo < blockHi - 1e-6) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Endpoint plumbing                                                   */
/* ------------------------------------------------------------------ */

/** The apron vertex: the endpoint pushed one cell out of its card, on-grid. */
function apronPoint(endpoint: GridEndpoint): GridPoint {
  switch (endpoint.side) {
    case "left":
      return { x: snapLine(endpoint.x) - WIRE_NODE_MARGIN, y: snapLine(endpoint.y) };
    case "right":
      return { x: snapLine(endpoint.x) + WIRE_NODE_MARGIN, y: snapLine(endpoint.y) };
    case "top":
      return { x: snapLine(endpoint.x), y: snapLine(endpoint.y) - WIRE_NODE_MARGIN };
    case "bottom":
      return { x: snapLine(endpoint.x), y: snapLine(endpoint.y) + WIRE_NODE_MARGIN };
  }
}

const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

/* ------------------------------------------------------------------ */
/* The solve                                                           */
/* ------------------------------------------------------------------ */

interface SolveContext {
  obstacles: GridObstacle[];
  occupancy: LaneOccupancy;
  /**
   * Dock points already taken, as "x,y". With whole-perimeter docking every
   * wire can have its own attachment point, so no two wires should ever
   * share one while free points remain — the claim is what spreads a fan of
   * wires around the card instead of piling them onto one spot.
   */
  usedDocks: Set<string>;
}

function dockKey(endpoint: GridEndpoint): string {
  return `${Math.round(endpoint.x)},${Math.round(endpoint.y)}`;
}

export function solveGridRoutes(
  obstacles: GridObstacle[],
  requests: GridRouteRequest[],
): Map<string, GridRoutedEdge> {
  const context: SolveContext = {
    obstacles,
    occupancy: new LaneOccupancy(),
    usedDocks: new Set(),
  };
  const results = new Map<string, GridRoutedEdge>();
  const sorted = [...requests].sort(
    (left, right) => left.order - right.order || (left.edgeId < right.edgeId ? -1 : 1),
  );
  for (const request of sorted) {
    results.set(request.edgeId, routeOne(context, request));
  }
  return results;
}

function routeOne(context: SolveContext, request: GridRouteRequest): GridRoutedEdge {
  const allSources = request.sources.filter(isFiniteEndpoint);
  const allTargets = request.targets.filter(isFiniteEndpoint);
  if (allSources.length === 0 || allTargets.length === 0) {
    return { edgeId: request.edgeId, points: [] };
  }
  // The frames this wire lives inside are not obstacles to it. Filtered per
  // request, not in the shared context: the same frame that lets a member
  // wire through must still turn every foreign wire away.
  const exempt = request.exemptObstacleIds;
  const obstacles =
    exempt && exempt.length > 0
      ? context.obstacles.filter((obstacle) => !exempt.includes(obstacle.id))
      : context.obstacles;
  // The frames this wire is on its way OUT of, kept as rects: crossing is
  // allowed, loitering is expensive (COST_INSIDE_EXEMPT). Frames holding
  // BOTH ends are its home instead — there, leaving is what costs.
  const home = request.homeObstacleIds;
  const exemptRects =
    exempt && exempt.length > 0
      ? context.obstacles.filter(
          (obstacle) =>
            exempt.includes(obstacle.id) && !(home && home.includes(obstacle.id)),
        )
      : [];
  const homeRects =
    home && home.length > 0
      ? context.obstacles.filter((obstacle) => home.includes(obstacle.id))
      : [];
  // A taken dock is off the menu — until the card is out of free ones, when
  // sharing beats failing.
  const freeSources = allSources.filter((e) => !context.usedDocks.has(dockKey(e)));
  const freeTargets = allTargets.filter((e) => !context.usedDocks.has(dockKey(e)));
  const sources = freeSources.length > 0 ? freeSources : allSources;
  const targets = freeTargets.length > 0 ? freeTargets : allTargets;
  const waypoints = (request.waypoints ?? []).filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  let pad = WINDOW_PAD;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const routed = routeWithinWindow(context, obstacles, exemptRects, homeRects, request, sources, targets, waypoints, pad);
    if (routed) {
      return routed;
    }
    pad *= WINDOW_GROWTH;
  }
  // Waypoints that cannot be reached (parked inside a card's margin, sealed
  // off) must not cost the wire its route: try again without them.
  if (waypoints.length > 0) {
    pad = WINDOW_PAD;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const routed = routeWithinWindow(context, obstacles, exemptRects, homeRects, request, sources, targets, [], pad);
      if (routed) {
        return routed;
      }
      pad *= WINDOW_GROWTH;
    }
  }

  // Boxed in (touching cards, sealed pockets): a plain L so the wire still
  // exists. It may cross things; there was no legal grid path to take.
  const source = sources[0];
  const target = targets[0];
  context.usedDocks.add(dockKey(source));
  context.usedDocks.add(dockKey(target));
  const sourceApron = apronPoint(source);
  const targetApron = apronPoint(target);
  return {
    edgeId: request.edgeId,
    points: compactPoints([
      { x: source.x, y: source.y },
      sourceApron,
      { x: sourceApron.x, y: targetApron.y },
      targetApron,
      { x: target.x, y: target.y },
    ]),
  };
}

function isFiniteEndpoint(endpoint: GridEndpoint): boolean {
  return Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y);
}

function routeWithinWindow(
  context: SolveContext,
  obstacles: GridObstacle[],
  exemptRects: GridObstacle[],
  homeRects: GridObstacle[],
  request: GridRouteRequest,
  sources: GridEndpoint[],
  targets: GridEndpoint[],
  waypoints: GridPoint[],
  pad: number,
): GridRoutedEdge | undefined {
  const sourceAprons = sources.map(apronPoint);
  const targetAprons = targets.map(apronPoint);
  const stops = waypoints.map((point) => ({ x: snapLine(point.x), y: snapLine(point.y) }));

  let windowLeft = Infinity;
  let windowRight = -Infinity;
  let windowTop = Infinity;
  let windowBottom = -Infinity;
  for (const point of [...sourceAprons, ...targetAprons, ...stops]) {
    if (point.x < windowLeft) windowLeft = point.x;
    if (point.x > windowRight) windowRight = point.x;
    if (point.y < windowTop) windowTop = point.y;
    if (point.y > windowBottom) windowBottom = point.y;
  }
  const span = windowRight - windowLeft + (windowBottom - windowTop);
  const grownPad = Math.max(pad, 0.5 * span);
  windowLeft -= grownPad;
  windowRight += grownPad;
  windowTop -= grownPad;
  windowBottom += grownPad;

  // Candidate lines: every card boundary pushed one and two cells out (the
  // travel lane and its overflow neighbour), plus each endpoint's own apron
  // lines and each waypoint's cross so starts, goals, and stops all exist
  // in the graph.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const obstacle of obstacles) {
    if (
      obstacle.right < windowLeft - 2 * BOARD_GRID ||
      obstacle.left > windowRight + 2 * BOARD_GRID ||
      obstacle.bottom < windowTop - 2 * BOARD_GRID ||
      obstacle.top > windowBottom + 2 * BOARD_GRID
    ) {
      continue;
    }
    const left = snapLine(obstacle.left);
    const right = snapLine(obstacle.right);
    const top = snapLine(obstacle.top);
    const bottom = snapLine(obstacle.bottom);
    xs.push(left - BOARD_GRID, left - 2 * BOARD_GRID, right + BOARD_GRID, right + 2 * BOARD_GRID);
    ys.push(top - BOARD_GRID, top - 2 * BOARD_GRID, bottom + BOARD_GRID, bottom + 2 * BOARD_GRID);
  }
  for (const point of [...sourceAprons, ...targetAprons, ...stops]) {
    xs.push(point.x);
    ys.push(point.y);
  }
  // The window's own edges, so two far-apart cards always have an outer
  // corridor between them even when nothing else contributes a line.
  xs.push(snapLine(windowLeft), snapLine(windowRight));
  ys.push(snapLine(windowTop), snapLine(windowBottom));

  const xAxis = buildAxis(xs.filter((x) => x >= windowLeft && x <= windowRight));
  const yAxis = buildAxis(ys.filter((y) => y >= windowTop && y <= windowBottom));
  if (xAxis.coords.length === 0 || yAxis.coords.length === 0) {
    return undefined;
  }

  const windowObstacles = obstacles.filter(
    (obstacle) =>
      obstacle.right >= windowLeft &&
      obstacle.left <= windowRight &&
      obstacle.bottom >= windowTop &&
      obstacle.top <= windowBottom,
  );
  // For a vertical line x=v: blocked while v is strictly inside the inflated
  // horizontal span, over the inflated vertical extent (and vice versa).
  const verticalBlocked = buildBlocked(
    xAxis.coords,
    windowObstacles,
    (o) => [o.left, o.right],
    (o) => [o.top, o.bottom],
  );
  const horizontalBlocked = buildBlocked(
    yAxis.coords,
    windowObstacles,
    (o) => [o.top, o.bottom],
    (o) => [o.left, o.right],
  );

  const xCount = xAxis.coords.length;
  const yCount = yAxis.coords.length;
  const stateCount = xCount * yCount * 4;

  const vertexOf = (point: GridPoint): number | undefined => {
    const xi = xAxis.index.get(point.x);
    const yi = yAxis.index.get(point.y);
    return xi === undefined || yi === undefined ? undefined : xi * yCount + yi;
  };

  const starts: Array<{ vertex: number; endpointIndex: number }> = [];
  for (let i = 0; i < sourceAprons.length; i += 1) {
    const vertex = vertexOf(sourceAprons[i]);
    if (vertex !== undefined) {
      starts.push({ vertex, endpointIndex: i });
    }
  }
  const goals = new Map<number, number>();
  for (let i = 0; i < targetAprons.length; i += 1) {
    const vertex = vertexOf(targetAprons[i]);
    if (vertex !== undefined && !goals.has(vertex)) {
      goals.set(vertex, i);
    }
  }
  if (starts.length === 0 || goals.size === 0) {
    return undefined;
  }
  const stopVertices: number[] = [];
  for (const stop of stops) {
    const vertex = vertexOf(stop);
    if (vertex === undefined) {
      return undefined;
    }
    stopVertices.push(vertex);
  }

  interface LegSeed {
    state: number;
    g: number;
    startIndex: number;
  }
  interface LegResult {
    startIndex: number;
    arrivalDir: number;
    vertices: GridPoint[];
    goalVertex: number;
  }

  /**
   * One A* leg over the shared graph. Seeds are (vertex, direction) states
   * with starting costs; goals map vertex to endpoint index; goalPenalty is
   * the dock's centre-bias cost, paid when finishing there. The best
   * (g + penalty) goal wins, not the first popped.
   */
  const searchLeg = (
    seeds: LegSeed[],
    legGoals: Map<number, number>,
    goalPenalty: (goalIndex: number) => number,
    goalAprons: GridPoint[],
  ): LegResult | undefined => {
    let goalLeft = Infinity;
    let goalRight = -Infinity;
    let goalTop = Infinity;
    let goalBottom = -Infinity;
    for (const apron of goalAprons) {
      if (apron.x < goalLeft) goalLeft = apron.x;
      if (apron.x > goalRight) goalRight = apron.x;
      if (apron.y < goalTop) goalTop = apron.y;
      if (apron.y > goalBottom) goalBottom = apron.y;
    }
    // Distance to the goal set's bounding box: a lower bound on the distance
    // to any goal, so admissibility holds at COST_EMPTY per pixel.
    const heuristic = (vertex: number): number => {
      const x = xAxis.coords[Math.floor(vertex / yCount)];
      const y = yAxis.coords[vertex % yCount];
      const dx = x < goalLeft ? goalLeft - x : x > goalRight ? x - goalRight : 0;
      const dy = y < goalTop ? goalTop - y : y > goalBottom ? y - goalBottom : 0;
      return (dx + dy) * COST_EMPTY;
    };

    const gScores = new Float64Array(stateCount).fill(Infinity);
    const cameFrom = new Int32Array(stateCount).fill(-1);
    const startOf = new Int32Array(stateCount).fill(-1);

    interface HeapEntry {
      f: number;
      g: number;
      state: number;
      /** Monotone tiebreak keeps the pop order deterministic. */
      seq: number;
    }
    const heap: HeapEntry[] = [];
    let seq = 0;
    const compareHeap = (left: HeapEntry, right: HeapEntry): number =>
      left.f - right.f || left.g - right.g || left.seq - right.seq;
    const push = (entry: HeapEntry) => {
      heap.push(entry);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (compareHeap(heap[parent], heap[i]) <= 0) {
          break;
        }
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    };
    const pop = (): HeapEntry | undefined => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0 && last) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const leftChild = i * 2 + 1;
          const rightChild = leftChild + 1;
          let smallest = i;
          if (leftChild < heap.length && compareHeap(heap[leftChild], heap[smallest]) < 0) {
            smallest = leftChild;
          }
          if (rightChild < heap.length && compareHeap(heap[rightChild], heap[smallest]) < 0) {
            smallest = rightChild;
          }
          if (smallest === i) {
            break;
          }
          [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
          i = smallest;
        }
      }
      return top;
    };

    for (const seed of seeds) {
      if (seed.g < gScores[seed.state]) {
        gScores[seed.state] = seed.g;
        startOf[seed.state] = seed.startIndex;
        push({
          f: seed.g + heuristic(Math.floor(seed.state / 4)),
          g: seed.g,
          state: seed.state,
          seq: (seq += 1),
        });
      }
    }

    let goalState = -1;
    let goalCost = Infinity;
    let pops = 0;
    while (heap.length > 0) {
      const current = pop();
      if (!current) {
        break;
      }
      if (current.f >= goalCost) {
        break;
      }
      if (current.g > gScores[current.state] + 1e-9) {
        continue;
      }
      pops += 1;
      if (pops > MAX_ASTAR_POPS) {
        return undefined;
      }
      const vertex = Math.floor(current.state / 4);
      const currentDir = current.state % 4;
      const goalIndex = legGoals.get(vertex);
      if (goalIndex !== undefined) {
        const cost = current.g + goalPenalty(goalIndex);
        if (cost < goalCost) {
          goalCost = cost;
          goalState = current.state;
        }
        // No break, no skip: goal vertices are ordinary vertices that other
        // routes (and cheaper docks past this one) travel through.
      }

      const xi = Math.floor(vertex / yCount);
      const yi = vertex % yCount;
      for (let dir = 0; dir < 4; dir += 1) {
        const { dx, dy } = DIRECTIONS[dir];
        const nxi = xi + dx;
        const nyi = yi + dy;
        if (nxi < 0 || nxi >= xCount || nyi < 0 || nyi >= yCount) {
          continue;
        }
        const fromX = xAxis.coords[xi];
        const fromY = yAxis.coords[yi];
        const toX = xAxis.coords[nxi];
        const toY = yAxis.coords[nyi];
        let laneAxis: "h" | "v";
        let laneLine: number;
        let from: number;
        let to: number;
        if (dy === 0) {
          // Horizontal move rides the horizontal line y = fromY.
          laneAxis = "h";
          laneLine = fromY;
          from = fromX;
          to = toX;
          if (!runIsFree(horizontalBlocked.byLine[yi], fromX, toX)) {
            continue;
          }
        } else {
          laneAxis = "v";
          laneLine = fromX;
          from = fromY;
          to = toY;
          if (!runIsFree(verticalBlocked.byLine[xi], fromY, toY)) {
            continue;
          }
        }

        const distance = Math.abs(to - from);
        const used = context.occupancy.usedWidth(laneAxis, laneLine, from, to);
        const fits = used === 0 || used + LANE_GAP + request.strokeWidth <= LANE_CAPACITY;
        const factor = used === 0 ? COST_EMPTY : fits ? COST_SHARED : COST_OVERFLOW;
        // Where this run sits relative to the frames that matter to it.
        // The border line itself counts as inside.
        const spanLo = Math.min(from, to);
        const spanHi = Math.max(from, to);
        const touches = (rect: GridObstacle): boolean =>
          laneAxis === "h"
            ? laneLine >= rect.top - 1e-6 &&
              laneLine <= rect.bottom + 1e-6 &&
              spanHi > rect.left - 1e-6 &&
              spanLo < rect.right + 1e-6
            : laneLine >= rect.left - 1e-6 &&
              laneLine <= rect.right + 1e-6 &&
              spanHi > rect.top - 1e-6 &&
              spanLo < rect.bottom + 1e-6;
        const within = (rect: GridObstacle): boolean =>
          laneAxis === "h"
            ? laneLine >= rect.top - 1e-6 &&
              laneLine <= rect.bottom + 1e-6 &&
              spanLo >= rect.left - 1e-6 &&
              spanHi <= rect.right + 1e-6
            : laneLine >= rect.left - 1e-6 &&
              laneLine <= rect.right + 1e-6 &&
              spanLo >= rect.top - 1e-6 &&
              spanHi <= rect.bottom + 1e-6;
        // Loitering in a frame the wire is leaving costs; so does straying
        // out of the frame it lives in. A run only counts as home when it
        // lies wholly inside — a run half out is already the excursion.
        const insideExempt = exemptRects.length > 0 && exemptRects.some(touches);
        const strayedFromHome = homeRects.length > 0 && !homeRects.every(within);
        const framePenalty =
          insideExempt || strayedFromHome
            ? insideExempt
              ? COST_INSIDE_EXEMPT
              : COST_OUTSIDE_HOME
            : 1;
        const stepCost =
          distance * factor * framePenalty + (dir === currentDir ? 0 : TURN_COST);
        const nextState = (nxi * yCount + nyi) * 4 + dir;
        const nextG = current.g + stepCost;
        if (nextG < gScores[nextState] - 1e-9) {
          gScores[nextState] = nextG;
          cameFrom[nextState] = current.state;
          startOf[nextState] = startOf[current.state];
          push({
            f: nextG + heuristic(nxi * yCount + nyi),
            g: nextG,
            state: nextState,
            seq: (seq += 1),
          });
        }
      }
    }

    if (goalState < 0) {
      return undefined;
    }
    const chain: number[] = [];
    for (let state = goalState; state >= 0; state = cameFrom[state]) {
      chain.push(Math.floor(state / 4));
    }
    chain.reverse();
    return {
      startIndex: startOf[goalState],
      arrivalDir: goalState % 4,
      goalVertex: Math.floor(goalState / 4),
      vertices: chain.map((vertex) => ({
        x: xAxis.coords[Math.floor(vertex / yCount)],
        y: yAxis.coords[vertex % yCount],
      })),
    };
  };

  // The legs: source, then each waypoint in order, then target. Each leg
  // restarts its costs (the dots are the user's law, not something to
  // optimise around), but carries the arrival direction so passing straight
  // through a dot is free and turning at it costs the normal turn.
  let seeds: LegSeed[] = [];
  for (const start of starts) {
    const startPenalty = sources[start.endpointIndex]?.penalty ?? 0;
    for (let dir = 0; dir < 4; dir += 1) {
      seeds.push({
        state: start.vertex * 4 + dir,
        g: startPenalty,
        startIndex: start.endpointIndex,
      });
    }
  }

  const mergedVertices: GridPoint[] = [];
  let sourceIndex: number | undefined;
  for (const stopVertex of stopVertices) {
    const stopPoint = {
      x: xAxis.coords[Math.floor(stopVertex / yCount)],
      y: yAxis.coords[stopVertex % yCount],
    };
    const leg = searchLeg(seeds, new Map([[stopVertex, 0]]), () => 0, [stopPoint]);
    if (!leg) {
      return undefined;
    }
    if (sourceIndex === undefined) {
      sourceIndex = leg.startIndex;
    }
    mergedVertices.push(...(mergedVertices.length > 0 ? leg.vertices.slice(1) : leg.vertices));
    seeds = [];
    for (let dir = 0; dir < 4; dir += 1) {
      seeds.push({
        state: stopVertex * 4 + dir,
        g: dir === leg.arrivalDir ? 0 : TURN_COST,
        startIndex: leg.startIndex,
      });
    }
  }

  const finalLeg = searchLeg(
    seeds,
    goals,
    (goalIndex) => targets[goalIndex]?.penalty ?? 0,
    targetAprons,
  );
  if (!finalLeg) {
    return undefined;
  }
  mergedVertices.push(
    ...(mergedVertices.length > 0 ? finalLeg.vertices.slice(1) : finalLeg.vertices),
  );

  const source = sources[sourceIndex ?? finalLeg.startIndex] ?? sources[0];
  const target = targets[goals.get(finalLeg.goalVertex) ?? 0] ?? targets[0];
  context.usedDocks.add(dockKey(source));
  context.usedDocks.add(dockKey(target));

  return {
    edgeId: request.edgeId,
    points: claimAndAssemble(context, request, source, target, compactPoints(mergedVertices)),
  };
}

/* ------------------------------------------------------------------ */
/* Lane claiming and the final polyline                                */
/* ------------------------------------------------------------------ */

/**
 * Turns the on-line vertex chain into the drawn polyline: every straight run
 * claims its slice of its lane and shifts sideways to it, corners re-join at
 * the offset intersections, and the true anchors go on the ends. The stubs —
 * anchor to first/last corner — stay at the anchor's exact coordinate, so a
 * wire always leaves a port dead straight.
 */
function claimAndAssemble(
  context: SolveContext,
  request: GridRouteRequest,
  source: GridEndpoint,
  target: GridEndpoint,
  vertices: GridPoint[],
): GridPoint[] {
  if (vertices.length === 0) {
    return [];
  }

  const sourceStubAxis: "h" | "v" =
    source.side === "left" || source.side === "right" ? "h" : "v";
  const targetStubAxis: "h" | "v" =
    target.side === "left" || target.side === "right" ? "h" : "v";
  // The visible ends. Deepened anchors stay collinear with their stub: the
  // segment adjacent to an anchor always runs along the side's normal, and
  // the tip only moves along that same normal.
  const sourceTip = stubTip(source);
  const targetTip = stubTip(target);

  // No moves at all: the two aprons share a vertex (adjacent ports). Pure
  // stub work, nothing claims a lane.
  if (vertices.length === 1) {
    const apron = vertices[0];
    const stubCorner = (endpoint: GridEndpoint, stubAxis: "h" | "v"): GridPoint =>
      stubAxis === "h" ? { x: apron.x, y: endpoint.y } : { x: endpoint.x, y: apron.y };
    return compactPoints([
      sourceTip,
      stubCorner(source, sourceStubAxis),
      apron,
      stubCorner(target, targetStubAxis),
      targetTip,
    ]);
  }

  interface Run {
    axis: "h" | "v";
    line: number;
    from: number;
    to: number;
    /** The coordinate this run actually draws at (line + lane offset). */
    drawn: number;
  }
  const runs: Run[] = [];
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    runs.push(
      a.y === b.y
        ? { axis: "h", line: a.y, from: a.x, to: b.x, drawn: a.y }
        : { axis: "v", line: a.x, from: a.y, to: b.y, drawn: a.x },
    );
  }
  // Which side of its lane each run should sit on: the side of the turn at
  // the run's end (the last run turns toward its target anchor). A wire that
  // will peel off leftward rides the left of a shared bundle, so leaving
  // never means crossing over a lane-mate — the crossing the pack order used
  // to manufacture at exactly the wrong moment.
  const departureFor = (index: number): number => {
    const run = runs[index];
    const next =
      index + 1 < runs.length
        ? runs[index + 1].line
        : run.axis === "h"
          ? target.y
          : target.x;
    return Math.sign(next - run.line);
  };
  runs.forEach((run, index) => {
    const existing = context.occupancy.claimsFor(run.axis, run.line, run.from, run.to);
    const slot = packIntoLane(existing, request.strokeWidth, departureFor(index));
    run.drawn = run.line + (slot.lo + slot.hi) / 2;
    context.occupancy.claim(run.axis, run.line, run.from, run.to, slot);
  });

  const points: GridPoint[] = [sourceTip];

  // Source stub onto the first run. When the run is PARALLEL to the stub
  // (the wire sets off along its own port line), it goes straight only as
  // far as the apron vertex, then jogs onto its packed lane. Pinning the
  // whole run to the anchor — the previous behaviour — put every wire out
  // of the same port on literally the same line for the run's full length.
  const first = runs[0];
  const sourceApron = vertices[0];
  if (first.axis === sourceStubAxis) {
    if (sourceStubAxis === "h") {
      points.push({ x: sourceApron.x, y: source.y }, { x: sourceApron.x, y: first.drawn });
    } else {
      points.push({ x: source.x, y: sourceApron.y }, { x: first.drawn, y: sourceApron.y });
    }
  } else {
    // Perpendicular: straight out at the anchor's coordinate to the run.
    points.push(
      sourceStubAxis === "h" ? { x: first.drawn, y: source.y } : { x: source.x, y: first.drawn },
    );
  }

  // Interior corners: intersection of neighbouring drawn lines. Two
  // consecutive runs on the SAME axis are a reversal — a waypoint excursion
  // turning around — so the corner is the turnaround vertex, with a small
  // jog between the two runs' lane slots (they pack side by side, which is
  // what keeps the out-and-back legible as two parallel lines).
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const runA = runs[i];
    const runB = runs[i + 1];
    if (runA.axis === runB.axis) {
      const turn = vertices[i + 1];
      if (runA.axis === "h") {
        points.push({ x: turn.x, y: runA.drawn }, { x: turn.x, y: runB.drawn });
      } else {
        points.push({ x: runA.drawn, y: turn.y }, { x: runB.drawn, y: turn.y });
      }
      continue;
    }
    points.push({
      x: runA.axis === "v" ? runA.drawn : runB.drawn,
      y: runA.axis === "h" ? runA.drawn : runB.drawn,
    });
  }

  // Target stub off the last run, mirroring the source: lane until the
  // apron, jog to the anchor, straight in.
  const last = runs[runs.length - 1];
  const targetApron = vertices[vertices.length - 1];
  if (last.axis === targetStubAxis) {
    if (targetStubAxis === "h") {
      points.push({ x: targetApron.x, y: last.drawn }, { x: targetApron.x, y: target.y });
    } else {
      points.push({ x: last.drawn, y: targetApron.y }, { x: target.x, y: targetApron.y });
    }
  } else {
    points.push(
      targetStubAxis === "h" ? { x: last.drawn, y: target.y } : { x: target.x, y: last.drawn },
    );
  }
  points.push(targetTip);

  return compactPoints(points);
}

/**
 * The drawn anchor: the endpoint pushed `stubDepth` further into the card,
 * along the side's inward normal. See GridEndpoint.stubDepth.
 */
function stubTip(endpoint: GridEndpoint): GridPoint {
  const depth = endpoint.stubDepth ?? 0;
  if (depth <= 0) {
    return { x: endpoint.x, y: endpoint.y };
  }
  switch (endpoint.side) {
    case "left":
      return { x: endpoint.x + depth, y: endpoint.y };
    case "right":
      return { x: endpoint.x - depth, y: endpoint.y };
    case "top":
      return { x: endpoint.x, y: endpoint.y + depth };
    case "bottom":
      return { x: endpoint.x, y: endpoint.y - depth };
  }
}

/**
 * Drops zero-length and collinear intermediate points — but ONLY when the
 * direction of travel is preserved. A point where the wire REVERSES along
 * the same line (a waypoint excursion: out to a dot and back the way it
 * came) is a real turnaround, and merging it used to swallow the entire
 * excursion, which read as the wire ignoring its dot.
 */
export function compactPoints(points: GridPoint[]): GridPoint[] {
  const kept: GridPoint[] = [];
  for (const point of points) {
    const prev = kept[kept.length - 1];
    if (prev && Math.abs(prev.x - point.x) < 0.01 && Math.abs(prev.y - point.y) < 0.01) {
      continue;
    }
    kept.push(point);
    while (kept.length >= 3) {
      const a = kept[kept.length - 3];
      const b = kept[kept.length - 2];
      const c = kept[kept.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
        (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
      const sameDirection =
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0;
      if (!collinear || !sameDirection) {
        break;
      }
      kept.splice(kept.length - 2, 1);
    }
  }
  return kept;
}
