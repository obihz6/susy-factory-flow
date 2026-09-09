import { readFileSync } from "node:fs";
import { it } from "vitest";
import { solveGridRoutes, type GridSolveStats } from "./grid-edge-router";
import { DEFAULT_ROUTER_TUNING } from "./router-tuning";
import { geometricCrossings } from "./router-crossings.local";

it("replays a capture", () => {
  const cap = JSON.parse(readFileSync(process.env.CAPTURE ?? "benzene-capture.local.json", "utf8"));
  const stats: GridSolveStats = { crossings: 0, rerouted: 0, fallbacks: 0 };
  const t0 = performance.now();
  const solved = solveGridRoutes(cap.obstacles, cap.requests, stats, { ...DEFAULT_ROUTER_TUNING, ...JSON.parse(process.env.TUNING ?? "{}") });
  const ms = performance.now() - t0;
  const per = geometricCrossings(solved);
  let total = 0; for (const n of per.values()) total += n;
  console.log(`ms=${ms.toFixed(1)} stats=${JSON.stringify(stats)} geometric crossings=${total / 2}`);
  if (process.env.ROUTES) for (const [id, r] of solved) console.log(`${id.slice(0, 12)} x${per.get(id) ?? 0}`, r.points.map((p) => `${p.x},${p.y}`).join(" "));
});
