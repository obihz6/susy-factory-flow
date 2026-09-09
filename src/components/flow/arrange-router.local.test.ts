import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { arrangeBoard, type ArrangeCard, type ArrangeWire } from "@/lib/board-arrange";
import { solveGridRoutes, type GridEndpoint, type GridObstacle, type GridRouteRequest, type GridPoint } from "./grid-edge-router";
import { totalCrossings } from "./router-crossings.local";
import { routePoints, measureWireRoutes } from "@/lib/route-metrics";
import { DEFAULT_ROUTER_TUNING } from "./router-tuning";

/**
 * Arrange a captured board, route it with the real router, count crossings
 * and wire length, and draw the result. CAPTURE=... OUT=... (svg).
 */
it("arranges a capture and routes it", { timeout: 600000 }, () => {
  const cap = JSON.parse(readFileSync(process.env.CAPTURE ?? "benzene-capture.local.json", "utf8"));
  const obstacles: GridObstacle[] = cap.obstacles.filter((o: GridObstacle) => !o.id.startsWith("pocket"));
  const requests: GridRouteRequest[] = cap.requests;
  const cards: ArrangeCard[] = obstacles.map((o) => ({
    id: o.id,
    x: o.left,
    y: o.top,
    width: o.right - o.left,
    height: o.bottom - o.top,
    role: o.id.startsWith("storage") ? "storage" : "machine",
  }));
  const wires: ArrangeWire[] = requests.map((r) => ({ id: r.edgeId, source: r.sourceCardId!, target: r.targetCardId! }));

  const measure = (obs: GridObstacle[], reqs: GridRouteRequest[]) => {
    const t0 = performance.now();
    const solved = solveGridRoutes(obs, reqs);
    const ms = performance.now() - t0;
    let length = 0;
    for (const r of solved.values()) for (let i = 1; i < r.points.length; i += 1) length += Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].y - r.points[i - 1].y);
    return { solved, ms, crossings: totalCrossings(solved), length: Math.round(length) };
  };
  const before = measure(obstacles, requests);
  console.log(`before: crossings=${before.crossings} length=${before.length} route ms=${before.ms.toFixed(0)}`);

  const judge = (positions: ReadonlyMap<string, { x: number; y: number }>): { crossings: number; length: number; points: number } => {
    const obs: GridObstacle[] = obstacles.map((o) => {
      const p = positions.get(o.id) ?? { x: o.left, y: o.top };
      return { id: o.id, left: p.x, top: p.y, right: p.x + (o.right - o.left), bottom: p.y + (o.bottom - o.top) };
    });
    const d = new Map(obstacles.map((o) => { const p = positions.get(o.id) ?? { x: o.left, y: o.top }; return [o.id, { dx: p.x - o.left, dy: p.y - o.top }]; }));
    const sh = (ends: GridEndpoint[], id: string) => { const v = d.get(id) ?? { dx: 0, dy: 0 }; return ends.map((e) => ({ ...e, x: e.x + v.dx, y: e.y + v.dy })); };
    const reqs = requests.map((r) => ({ ...r, sources: sh(r.sources, r.sourceCardId!), targets: sh(r.targets, r.targetCardId!), waypoints: undefined }));
    const solved = solveGridRoutes(obs, reqs);
    const measure = measureWireRoutes(solved.values());
    return { crossings: totalCrossings(solved), length: measure.length, points: routePoints(measure, DEFAULT_ROUTER_TUNING) };
  };
  const t0 = performance.now();
  const result = arrangeBoard({ cards, wires, origin: { x: 0, y: 0 }, judge });
  const arrangeMs = performance.now() - t0;
  const moved = new Map(result.moves.map((m) => [m.id, m.position]));
  const delta = new Map<string, { dx: number; dy: number }>();
  const movedObstacles: GridObstacle[] = obstacles.map((o) => {
    const p = moved.get(o.id) ?? { x: o.left, y: o.top };
    delta.set(o.id, { dx: p.x - o.left, dy: p.y - o.top });
    return { id: o.id, left: p.x, top: p.y, right: p.x + (o.right - o.left), bottom: p.y + (o.bottom - o.top) };
  });
  const shift = (ends: GridEndpoint[], id: string): GridEndpoint[] => {
    const d = delta.get(id) ?? { dx: 0, dy: 0 };
    return ends.map((e) => ({ ...e, x: e.x + d.dx, y: e.y + d.dy }));
  };
  const movedRequests: GridRouteRequest[] = requests.map((r) => ({
    ...r,
    sources: shift(r.sources, r.sourceCardId!),
    targets: shift(r.targets, r.targetCardId!),
    waypoints: undefined,
  }));
  const after = measure(movedObstacles, movedRequests);
  console.log(`after:  crossings=${after.crossings} length=${after.length} route ms=${after.ms.toFixed(0)} arrange ms=${arrangeMs.toFixed(0)} islands=${result.islands.length}`);

  const out = process.env.OUT;
  if (out) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of movedObstacles) { minX = Math.min(minX, o.left); minY = Math.min(minY, o.top); maxX = Math.max(maxX, o.right); maxY = Math.max(maxY, o.bottom); }
    const pad = 60;
    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}" style="background:#111">`);
    for (const o of movedObstacles) parts.push(`<rect x="${o.left}" y="${o.top}" width="${o.right - o.left}" height="${o.bottom - o.top}" fill="#223" stroke="#557" stroke-width="2"/><text x="${o.left + 6}" y="${o.top + 16}" fill="#99a" font-size="12">${o.id.slice(0, 10)}</text>`);
    const colors = ["#f5b642", "#6f9cff", "#c78bff", "#4fd1a5", "#ff6f6f", "#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#f78c6b"];
    let ci = 0;
    for (const r of after.solved.values()) parts.push(`<polyline points="${r.points.map((p: GridPoint) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${colors[ci++ % colors.length]}" stroke-width="3" opacity="0.9"/>`);
    parts.push("</svg>");
    writeFileSync(out, parts.join("\n"));
  }
});
