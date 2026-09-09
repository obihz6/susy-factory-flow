import { readFileSync } from "node:fs";
import { it } from "vitest";
import { parseLayout } from "./board-layout-string";
import { makeRouteJudge } from "./route-judge";
import { BOARD_GRID } from "./board-grid";
import {
  pathBends,
  pathBlocked,
  pathCrossings,
  pathLength,
  proxyPath,
  routerPrices,
  type Path,
  type Rect,
} from "./board-arrange-optimize";
import { wireWeight } from "./route-metrics";
import {
  solveGridRoutes,
  type GridEndpoint,
  type GridObstacle,
  type GridRouteRequest,
} from "@/components/flow/grid-edge-router";
import { measureWireRoutes } from "./route-metrics";
import { DEFAULT_ROUTER_TUNING } from "@/components/flow/router-tuning";

/**
 * PROXY VS ROUTER: scores layout strings (LAYOUTS=a.json,b.json) with the
 * arranger's proxy AND the real router, so the two can be compared. The
 * proxy is only useful when it ranks layouts the way the router does.
 */
it("scores layouts by proxy and by router", { timeout: 900000 }, () => {
  const files = (process.env.LAYOUTS ?? "layout.json").split(",");
  const prices = routerPrices();
  for (const file of files) {
    const layout = parseLayout(readFileSync(file, "utf8"));
    const rects: Rect[] = layout.cards.map((card) => ({
      left: card.x,
      top: card.y,
      right: card.x + (card.width ?? 440),
      bottom: card.y + (card.height ?? 300),
    }));
    const index = new Map(layout.cards.map((card, i) => [card.id, i]));
    const wires = layout.wires ?? [];
    const paths: Path[] = [];
    const weights: number[] = [];
    let length = 0;
    let bends = 0;
    let blocked = 0;
    for (const wire of wires) {
      const a = index.get(wire.source)!;
      const b = index.get(wire.target)!;
      const path = proxyPath(rects[a], rects[b]);
      const w = wireWeight(wire.width);
      paths.push(path);
      weights.push(w);
      length += pathLength(path) * w;
      bends += pathBends(path, prices) * w;
      blocked += pathBlocked(path, rects, a, b, prices) * w;
    }
    let crossings = 0;
    let crossCost = 0;
    for (let i = 0; i < paths.length; i += 1)
      for (let j = i + 1; j < paths.length; j += 1) {
        const c = pathCrossings(paths[i], paths[j]);
        crossings += c;
        crossCost += c * prices.crossing * Math.max(weights[i], weights[j]);
      }
    const proxy = length + bends + blocked + crossCost;

    const rim = (rect: GridObstacle): GridEndpoint[] => {
      const out: GridEndpoint[] = [];
      const keepOut = (span: number) => (span >= 2 * BOARD_GRID ? BOARD_GRID : 0);
      const kx = keepOut(rect.right - rect.left);
      const ky = keepOut(rect.bottom - rect.top);
      for (let x = rect.left + kx; x <= rect.right - kx; x += BOARD_GRID) {
        out.push({ x, y: rect.top, side: "top" }, { x, y: rect.bottom, side: "bottom" });
      }
      for (let y = rect.top + ky; y <= rect.bottom - ky; y += BOARD_GRID) {
        out.push({ x: rect.left, y, side: "left" }, { x: rect.right, y, side: "right" });
      }
      return out;
    };
    const obstacles: GridObstacle[] = layout.cards.map((card, i) => ({ id: card.id, ...rects[i] }));
    const byId = new Map(obstacles.map((o) => [o.id, o]));
    const requests: GridRouteRequest[] = wires.map((wire, i) => ({
      edgeId: wire.id ?? `w${i}`,
      order: i,
      sources: rim(byId.get(wire.source)!),
      targets: rim(byId.get(wire.target)!),
      sourceCardId: wire.source,
      targetCardId: wire.target,
      strokeWidth: wire.width ?? 6,
    }));
    const real = makeRouteJudge(obstacles, requests, DEFAULT_ROUTER_TUNING)(
      new Map(obstacles.map((o) => [o.id, { x: o.left, y: o.top }])),
    );
    if (process.env.PERWIRE) {
      const solved = solveGridRoutes(obstacles, requests, undefined, DEFAULT_ROUTER_TUNING);
      const cell = (q: { x: number; y: number }) => `${Math.round(q.x / 20)},${Math.round(q.y / 20)}`;
      const rows = wires.map((wire, i) => {
        const route = solved.get(wire.id ?? `w${i}`);
        const m = route ? measureWireRoutes([{ edgeId: "x", points: route.points }]) : undefined;
        const realCost = m
          ? m.length + m.bends45 * prices.turn45 + (m.bends90 + 3 * m.bendsSharp) * prices.turn90
          : NaN;
        const a = index.get(wire.source)!;
        const b = index.get(wire.target)!;
        const proxyCost =
          pathLength(paths[i]) + pathBends(paths[i], prices) + pathBlocked(paths[i], rects, a, b, prices);
        return {
          wire: `${wire.source}>${wire.target}`,
          proxyCost,
          realCost,
          path: paths[i].map(cell).join(" "),
          real: route?.points.map(cell).join(" ") ?? "",
        };
      });
      rows.sort((x, y) => y.proxyCost - y.realCost - (x.proxyCost - x.realCost));
      for (const row of rows.slice(0, 10)) {
        console.log(
          `  ${row.wire} proxy ${Math.round(row.proxyCost)} real ${Math.round(row.realCost)}\n    proxy ${row.path}\n    real  ${row.real}`,
        );
      }
    }
    console.log(
      `${file}: proxy ${Math.round(proxy)} (length ${Math.round(length)} bends ${Math.round(bends)} blocked ${Math.round(blocked)} crossings ${crossings} = ${Math.round(crossCost)}) | router ${Math.round(real.points)} (crossings ${real.crossings} length ${Math.round(real.length)})`,
    );
  }
});
