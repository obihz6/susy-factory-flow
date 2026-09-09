import { readFileSync } from "node:fs";
import { it } from "vitest";
import { parseLayout } from "./board-layout-string";
import { makeRouteJudge } from "./route-judge";
import { BOARD_GRID } from "./board-grid";
import type { GridEndpoint, GridObstacle, GridRouteRequest } from "@/components/flow/grid-edge-router";
import { DEFAULT_ROUTER_TUNING } from "@/components/flow/router-tuning";
it("scores a layout string as it stands", () => {
  const layout = parseLayout(readFileSync(process.env.LAYOUT!, "utf8"));
  const rim = (rect: GridObstacle): GridEndpoint[] => { const out: GridEndpoint[] = []; const k = (s: number) => (s < 6 * BOARD_GRID ? BOARD_GRID : 2 * BOARD_GRID); const kx = k(rect.right - rect.left), ky = k(rect.bottom - rect.top); for (let x = rect.left + kx; x <= rect.right - kx; x += BOARD_GRID) out.push({ x, y: rect.top, side: "top" }, { x, y: rect.bottom, side: "bottom" }); for (let y = rect.top + ky; y <= rect.bottom - ky; y += BOARD_GRID) out.push({ x: rect.left, y, side: "left" }, { x: rect.right, y, side: "right" }); return out; };
  const obstacles: GridObstacle[] = layout.cards.map((c) => ({ id: c.id, left: c.x, top: c.y, right: c.x + (c.width ?? 440), bottom: c.y + (c.height ?? 300) }));
  const byId = new Map(obstacles.map((o) => [o.id, o]));
  const requests: GridRouteRequest[] = (layout.wires ?? []).map((w, i) => ({ edgeId: w.id ?? `w${i}`, order: i, sources: rim(byId.get(w.source)!), targets: rim(byId.get(w.target)!), sourceCardId: w.source, targetCardId: w.target, strokeWidth: w.width ?? 6 }));
  const tuning = { ...DEFAULT_ROUTER_TUNING, ...JSON.parse(process.env.TUNING ?? "{}") };
  const v = makeRouteJudge(obstacles, requests, tuning)(new Map(obstacles.map((o) => [o.id, { x: o.left, y: o.top }])));
  console.log(`score: crossings ${v.crossings} points ${Math.round(v.points)} length ${Math.round(v.length)}` + (layout.score ? ` (screen: ${layout.score.crossings} / ${layout.score.points} pts / ${layout.score.length} px)` : ""));
});
