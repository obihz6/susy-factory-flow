import { describe, expect, it } from "vitest";
import {
  LANE_CAPACITY,
  WIRE_NODE_MARGIN,
  laneWidthForHeat,
  solveGridRoutes,
  type GridObstacle,
  type GridPoint,
  type GridRouteRequest,
} from "./grid-edge-router";

/** A recipe-card-shaped obstacle on the grid. */
function card(id: string, x: number, y: number, width = 360, height = 160): GridObstacle {
  return { id, left: x, top: y, right: x + width, bottom: y + height };
}

function request(partial: Partial<GridRouteRequest> & Pick<GridRouteRequest, "edgeId">): GridRouteRequest {
  return {
    order: 0,
    sources: [],
    targets: [],
    strokeWidth: 4,
    ...partial,
  };
}

function segments(points: GridPoint[]) {
  const list: Array<{ a: GridPoint; b: GridPoint }> = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    list.push({ a: points[i], b: points[i + 1] });
  }
  return list;
}

/** Does any segment enter the obstacle's margin-inflated interior? */
function violatesMargin(points: GridPoint[], obstacle: GridObstacle, skipEnds = 1): boolean {
  const left = obstacle.left - WIRE_NODE_MARGIN;
  const right = obstacle.right + WIRE_NODE_MARGIN;
  const top = obstacle.top - WIRE_NODE_MARGIN;
  const bottom = obstacle.bottom + WIRE_NODE_MARGIN;
  const all = segments(points);
  // Stubs at either end legitimately cross their own card's margin.
  const middle = all.slice(skipEnds, all.length - skipEnds);
  return middle.some(({ a, b }) => {
    const loX = Math.min(a.x, b.x);
    const hiX = Math.max(a.x, b.x);
    const loY = Math.min(a.y, b.y);
    const hiY = Math.max(a.y, b.y);
    return hiX > left + 0.01 && loX < right - 0.01 && hiY > top + 0.01 && loY < bottom - 0.01;
  });
}

function isOrthogonal(points: GridPoint[]): boolean {
  return segments(points).every(
    ({ a, b }) => Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01,
  );
}

describe("laneWidthForHeat", () => {
  it("quantizes to lane fractions and never exceeds the lane", () => {
    expect(laneWidthForHeat(0)).toBe(4);
    expect(laneWidthForHeat(0.1)).toBe(5);
    expect(laneWidthForHeat(0.25)).toBe(6);
    expect(laneWidthForHeat(0.5)).toBe(8);
    expect(laneWidthForHeat(0.75)).toBe(10);
    expect(laneWidthForHeat(0.9)).toBe(12);
    expect(laneWidthForHeat(1)).toBe(LANE_CAPACITY);
    expect(laneWidthForHeat(2)).toBe(LANE_CAPACITY);
  });

  it("gives adjacent heats distinct widths across the whole range", () => {
    // Eight steps, evenly indexed: a step exists roughly every 0.14 of heat.
    const widths = new Set<number>();
    for (let heat = 0; heat <= 1.0001; heat += 1 / 14) {
      widths.add(laneWidthForHeat(heat));
    }
    expect(widths.size).toBe(8);
  });
});

describe("solveGridRoutes", () => {
  it("routes a facing pair straight across", () => {
    const a = card("a", 0, 0);
    const b = card("b", 480, 0);
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 480, y: 60, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points[0]).toEqual({ x: 360, y: 60 });
    expect(points[points.length - 1]).toEqual({ x: 480, y: 60 });
    expect(isOrthogonal(points)).toBe(true);
    // Straight shot: no vertical wandering.
    expect(points.every((point) => Math.abs(point.y - 60) < 0.01)).toBe(true);
  });

  it("keeps one cell of clearance around a blocking card", () => {
    const a = card("a", 0, 0);
    const blocker = card("blocker", 480, -20, 360, 200);
    const b = card("b", 960, 0);
    const routes = solveGridRoutes(
      [a, blocker, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 960, y: 60, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points.length).toBeGreaterThan(2);
    expect(isOrthogonal(points)).toBe(true);
    expect(violatesMargin(points, blocker, 0)).toBe(false);
    expect(violatesMargin(points, a)).toBe(false);
    expect(violatesMargin(points, b)).toBe(false);
  });

  it("travels on grid lines outside the port stubs", () => {
    const a = card("a", 0, 0);
    const b = card("b", 700, 400);
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 700, y: 460, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    // Interior corners land on grid multiples (lane offsets are 0 for a lone
    // wire, so the drawn lines ARE the grid lines).
    for (const point of points.slice(1, -1)) {
      const onGridX = Math.abs(point.x % 20) < 0.01 || Math.abs((point.x % 20) - 20) < 0.01;
      const onGridY =
        Math.abs(point.y - 60) < 0.01 ||
        Math.abs(point.y - 460) < 0.01 ||
        Math.abs(point.y % 20) < 0.01 ||
        Math.abs((point.y % 20) - 20) < 0.01;
      expect(onGridX || Math.abs(point.x - 360) < 0.01 || Math.abs(point.x - 700) < 0.01).toBe(true);
      expect(onGridY).toBe(true);
    }
  });

  it("lets two wires share a lane side by side without overlapping", () => {
    const a = card("a", 0, 0);
    const b = card("b", 1000, 600);
    // Two ports on each card wired straight across the same diagonal — their
    // best corridors coincide, so they should ride together, offset apart.
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          order: 0,
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1000, y: 660, side: "left" }],
        }),
        request({
          edgeId: "e2",
          order: 1,
          sources: [{ x: 360, y: 100, side: "right" }],
          targets: [{ x: 1000, y: 700, side: "left" }],
        }),
      ],
    );
    const first = routes.get("e1")!.points;
    const second = routes.get("e2")!.points;
    expect(isOrthogonal(first)).toBe(true);
    expect(isOrthogonal(second)).toBe(true);

    // No two parallel interior segments may sit on the same coordinate: lane
    // sharing must have offset one of them.
    const firstVerticalXs = segments(first)
      .filter(({ a: p, b: q }) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) > 1)
      .map(({ a: p }) => p.x);
    const secondVerticalXs = segments(second)
      .filter(({ a: p, b: q }) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) > 1)
      .map(({ a: p }) => p.x);
    for (const x1 of firstVerticalXs) {
      for (const x2 of secondVerticalXs) {
        if (Math.abs(x1 - x2) < 10) {
          // Same lane: they must be offset by at least the stroke width.
          expect(Math.abs(x1 - x2)).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("fans same-port wires apart right after the apron", () => {
    const a = card("a", 0, 0);
    const b = card("b", 900, 0, 360, 300);
    // Two wires out of the SAME output, into two different inputs far away.
    // They used to draw on literally the same line for the whole shared run;
    // now they may only coincide inside the port stub zone (a couple of
    // cells around the shared anchor).
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          order: 0,
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 900, y: 60, side: "left" }],
        }),
        request({
          edgeId: "e2",
          order: 1,
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 900, y: 260, side: "left" }],
        }),
      ],
    );
    const first = routes.get("e1")!.points;
    const second = routes.get("e2")!.points;
    const horizontalRuns = (points: GridPoint[]) =>
      segments(points)
        .filter(({ a: p, b: q }) => Math.abs(p.y - q.y) < 0.01 && Math.abs(p.x - q.x) > 1)
        .map(({ a: p, b: q }) => ({ y: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) }));
    const STUB_ZONE = 360 + 2 * WIRE_NODE_MARGIN;
    for (const runA of horizontalRuns(first)) {
      for (const runB of horizontalRuns(second)) {
        const overlapLo = Math.max(runA.lo, runB.lo, STUB_ZONE);
        const overlapHi = Math.min(runA.hi, runB.hi);
        if (overlapHi - overlapLo > 4 && Math.abs(runA.y - runB.y) < 1.9) {
          throw new Error(
            `stacked runs: y=${runA.y} vs y=${runB.y} over x ${overlapLo}..${overlapHi}`,
          );
        }
      }
    }
  });

  it("claims docks so parallel wires attach at different points", () => {
    const a = card("a", 0, 0);
    const b = card("b", 800, 0);
    // Both cards offer a few perimeter docks (the host offers the whole
    // ring); two wires between the same pair must not share an attachment.
    const ring = (rect: GridObstacle): GridRouteRequest["sources"] => {
      const docks: GridRouteRequest["sources"] = [];
      for (let y = rect.top; y <= rect.bottom; y += 40) {
        docks.push({ x: rect.left, y, side: "left" }, { x: rect.right, y, side: "right" });
      }
      for (let x = rect.left; x <= rect.right; x += 40) {
        docks.push({ x, y: rect.top, side: "top" }, { x, y: rect.bottom, side: "bottom" });
      }
      return docks;
    };
    const routes = solveGridRoutes(
      [a, b],
      [
        request({ edgeId: "e1", order: 0, sources: ring(a), targets: ring(b) }),
        request({ edgeId: "e2", order: 1, sources: ring(a), targets: ring(b) }),
      ],
    );
    const first = routes.get("e1")!.points;
    const second = routes.get("e2")!.points;
    const key = (p: GridPoint) => `${Math.round(p.x)},${Math.round(p.y)}`;
    expect(key(first[0])).not.toBe(key(second[0]));
    expect(key(first[first.length - 1])).not.toBe(key(second[second.length - 1]));
  });

  it("prefers penalty-free docks when routes cost the same", () => {
    const a = card("a", 0, 0);
    const b = card("b", 600, 0);
    // Facing cards: every right-side dock of A pairs with a left-side dock
    // of B at identical route cost, so the centre bias (penalties) must be
    // the tiebreak — without it the corner-most seed wins on heap order.
    const docks = (x: number, side: "left" | "right", center: number) => {
      const list: GridRouteRequest["sources"] = [];
      for (let y = 40; y <= 120; y += 40) {
        list.push({ x, y, side, penalty: Math.abs(y - center) * 0.25 });
      }
      return list;
    };
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: docks(360, "right", 80),
          targets: docks(600, "left", 80),
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points[0].y).toBe(80);
    expect(points[points.length - 1].y).toBe(80);
  });

  it("routes through user waypoints in order", () => {
    const a = card("a", 0, 0);
    const b = card("b", 800, 0);
    // A straight shot would run along y=60; the waypoint drags the wire down
    // through (580, 400) first.
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 800, y: 60, side: "left" }],
          waypoints: [{ x: 580, y: 400 }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(isOrthogonal(points)).toBe(true);
    // The wire must pass within a lane's width of the pinned dot.
    const nearWaypoint = points.some(
      (point) => Math.abs(point.x - 580) <= 10 && Math.abs(point.y - 400) <= 10,
    );
    expect(nearWaypoint).toBe(true);
  });

  it("doubles back to honour waypoint order rather than skipping a stop", () => {
    const a = card("a", 0, 0);
    const b = card("b", 1200, 0);
    // First stop DOWNSTREAM, second stop back UPSTREAM: the wire must visit
    // them in that order, out and back, not silently drop the excursion.
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1200, y: 60, side: "left" }],
          waypoints: [
            { x: 1000, y: 300 },
            { x: 500, y: 300 },
          ],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(isOrthogonal(points)).toBe(true);
    const indexNear = (x: number, y: number) =>
      points.findIndex((point) => Math.abs(point.x - x) <= 10 && Math.abs(point.y - y) <= 10);
    const firstStop = indexNear(1000, 300);
    const secondStop = indexNear(500, 300);
    expect(firstStop).toBeGreaterThan(-1);
    expect(secondStop).toBeGreaterThan(-1);
    expect(firstStop).toBeLessThan(secondStop);
  });

  it("ignores a waypoint sealed inside a card rather than failing", () => {
    const a = card("a", 0, 0);
    const b = card("b", 800, 0);
    const routes = solveGridRoutes(
      [a, b],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 800, y: 60, side: "left" }],
          // Dead centre of card B: unreachable.
          waypoints: [{ x: 980, y: 80 }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(points)).toBe(true);
  });

  it("is deterministic", () => {
    const obstacles = [card("a", 0, 0), card("b", 700, 300), card("c", 200, 400)];
    const requests = [
      request({
        edgeId: "e1",
        order: 0,
        sources: [{ x: 360, y: 60, side: "right" as const }],
        targets: [{ x: 700, y: 360, side: "left" as const }],
      }),
      request({
        edgeId: "e2",
        order: 1,
        sources: [{ x: 360, y: 100, side: "right" as const }],
        targets: [{ x: 200, y: 480, side: "right" as const }],
      }),
    ];
    const first = solveGridRoutes(obstacles, requests);
    const second = solveGridRoutes(obstacles, requests);
    expect(JSON.stringify([...first.entries()])).toBe(JSON.stringify([...second.entries()]));
  });

  it("picks the best storage side from candidates", () => {
    const a = card("a", 0, 0);
    const drawer: GridObstacle = { id: "d", left: 600, top: 20, right: 740, bottom: 180 };
    const routes = solveGridRoutes(
      [a, drawer],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [
            { x: 600, y: 100, side: "left" },
            { x: 740, y: 100, side: "right" },
            { x: 660, y: 20, side: "top" },
            { x: 660, y: 180, side: "bottom" },
          ],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    // The producer sits to the drawer's left: the wire should dock on the
    // drawer's left face, not loop around to the far side.
    const end = points[points.length - 1];
    expect(end.x).toBe(600);
    expect(end.y).toBe(100);
  });

  it("returns a fallback polyline rather than nothing when boxed in", () => {
    // A target completely walled off by touching cards.
    const walls = [
      card("w1", 400, -400, 60, 1200),
      card("w2", 400, 800, 1200, 60),
    ];
    const routes = solveGridRoutes(
      [card("a", 0, 0), ...walls],
      [
        request({
          edgeId: "e1",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 2000, y: 2000, side: "left" }],
        }),
      ],
    );
    const points = routes.get("e1")!.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(points)).toBe(true);
  });

  it("a board frame turns foreign wires away like a card", () => {
    // Two facing cards with an open board frame standing between them.
    const a = card("a", 0, 0);
    const b = card("b", 1200, 0);
    const frame: GridObstacle = { id: "frame", left: 480, top: -200, right: 840, bottom: 360 };
    const foreign = solveGridRoutes(
      [a, b, frame],
      [
        request({
          edgeId: "foreign",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1200, y: 60, side: "left" }],
        }),
      ],
    ).get("foreign")!.points;
    expect(isOrthogonal(foreign)).toBe(true);
    expect(violatesMargin(foreign, frame, 0)).toBe(false);
  });

  it("a member's wire crosses its own frame and leaves by the shortest way", () => {
    // A card outside, a member card inside the frame's right half: the wire
    // must cross the border (the frame cannot block its own member's wire)
    // and must not run the length of the frame's rim to get there.
    const outside = card("outside", 0, 0);
    const frame: GridObstacle = { id: "frame", left: 480, top: -200, right: 1400, bottom: 600 };
    const member = card("member", 1000, 0);
    const points = solveGridRoutes(
      [outside, frame, member],
      [
        request({
          edgeId: "member",
          sources: [{ x: 360, y: 60, side: "right" }],
          targets: [{ x: 1000, y: 60, side: "left" }],
          exemptObstacleIds: ["frame"],
        }),
      ],
    ).get("member")!.points;

    expect(isOrthogonal(points)).toBe(true);
    // It arrives: the frame never blocks a wire that belongs to it.
    expect(points[points.length - 1]).toEqual({ x: 1000, y: 60 });

    // And it spends only the crossing inside the frame — the straight run
    // from the border to the card, not a lap of the rim. Each segment is
    // clipped to the frame so a run that enters part-way counts only the
    // part that is actually in there.
    let insideLength = 0;
    for (const { a: from, b: to } of segments(points)) {
      const overlap = (lo: number, hi: number, min: number, max: number) =>
        Math.max(0, Math.min(hi, max) - Math.max(lo, min));
      const spanX = overlap(
        Math.min(from.x, to.x),
        Math.max(from.x, to.x),
        frame.left,
        frame.right,
      );
      const spanY = overlap(
        Math.min(from.y, to.y),
        Math.max(from.y, to.y),
        frame.top,
        frame.bottom,
      );
      // One of the two is zero on an orthogonal run; a run is inside only
      // while its fixed coordinate is inside as well.
      if (from.y === to.y && from.y >= frame.top && from.y <= frame.bottom) {
        insideLength += spanX;
      } else if (from.x === to.x && from.x >= frame.left && from.x <= frame.right) {
        insideLength += spanY;
      }
    }
    // The card's left edge is 520 past the border; a cell of slack covers
    // the dock stub. A wire that ran the rim would be several times this.
    expect(insideLength).toBeLessThanOrEqual(1000 - 480 + WIRE_NODE_MARGIN);
  });

  it("a wire between two cards on one board never leaves it", () => {
    // Two members side by side inside a roomy frame. The frame is exempt
    // for this wire AND holds both its ends, so the route has to stay in:
    // ducking out to the open board and back is what this forbids.
    const frame: GridObstacle = { id: "frame", left: 0, top: 0, right: 1400, bottom: 500 };
    const left = card("left", 100, 160);
    const right = card("right", 900, 160);
    const points = solveGridRoutes(
      [frame, left, right],
      [
        request({
          edgeId: "inner",
          sources: [{ x: 460, y: 220, side: "right" }],
          targets: [{ x: 900, y: 220, side: "left" }],
          exemptObstacleIds: ["frame"],
          homeObstacleIds: ["frame"],
        }),
      ],
    ).get("inner")!.points;

    expect(isOrthogonal(points)).toBe(true);
    // Every corner of the route sits inside the room it belongs to.
    expect(
      points.every(
        (point) =>
          point.x >= frame.left &&
          point.x <= frame.right &&
          point.y >= frame.top &&
          point.y <= frame.bottom,
      ),
    ).toBe(true);
  });
});
