import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { solveGridRoutes, type GridSolveStats, type GridPoint } from "./grid-edge-router";
import { DEFAULT_ROUTER_TUNING } from "./router-tuning";
import { geometricCrossings } from "./router-crossings.local";

/**
 * Replays a capture and writes an SVG of the board and its routes, every
 * geometric crossing marked, plus a per-wire table comparing the router's
 * own crossing count with the geometric one. CAPTURE=... OUT=... .
 */
it("audits a capture", () => {
  const cap = JSON.parse(readFileSync(process.env.CAPTURE ?? "benzene-capture.local.json", "utf8"));
  const stats: GridSolveStats = { crossings: 0, rerouted: 0, fallbacks: 0 };
  const solved = solveGridRoutes(cap.obstacles, cap.requests, stats, { ...DEFAULT_ROUTER_TUNING, ...JSON.parse(process.env.TUNING ?? "{}") });
  const per = geometricCrossings(solved);

  // Every proper crossing as a point, with the two wires.
  const segs: Array<{ id: string; a: GridPoint; b: GridPoint }> = [];
  for (const [id, r] of solved) for (let i = 0; i + 1 < r.points.length; i += 1) segs.push({ id, a: r.points[i], b: r.points[i + 1] });
  const marks: Array<{ x: number; y: number; a: string; b: string }> = [];
  const cross = (o: GridPoint, a: GridPoint, b: GridPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < segs.length; i += 1) for (let j = i + 1; j < segs.length; j += 1) {
    const s = segs[i], t = segs[j];
    if (s.id === t.id) continue;
    const d1 = cross(s.a, s.b, t.a), d2 = cross(s.a, s.b, t.b), d3 = cross(t.a, t.b, s.a), d4 = cross(t.a, t.b, s.b);
    const eps = 0.5;
    if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
      const ux = s.b.x - s.a.x, uy = s.b.y - s.a.y, vx = t.b.x - t.a.x, vy = t.b.y - t.a.y;
      const den = ux * vy - uy * vx;
      const tt = ((t.a.x - s.a.x) * vy - (t.a.y - s.a.y) * vx) / den;
      marks.push({ x: s.a.x + ux * tt, y: s.a.y + uy * tt, a: s.id, b: t.id });
    }
  }

  console.log(`stats=${JSON.stringify({ ...stats, perEdge: undefined })} geometric=${marks.length}`);
  console.log("wire            router geom  route");
  for (const [id, r] of solved) {
    const own = stats.perEdge?.[id];
    const g = per.get(id) ?? 0;
    const flag = (own?.crossings ?? 0) !== g ? " <-- differs" : "";
    console.log(`${id.slice(0, 14).padEnd(15)} ${String(own?.crossings ?? 0).padStart(3)}   ${String(g).padStart(3)}  ${r.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ")}${flag}`);
  }
  for (const m of marks) console.log(`X at ${Math.round(m.x)},${Math.round(m.y)}: ${m.a.slice(0, 12)} x ${m.b.slice(0, 12)}`);

  // SVG.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of cap.obstacles) { minX = Math.min(minX, o.left); minY = Math.min(minY, o.top); maxX = Math.max(maxX, o.right); maxY = Math.max(maxY, o.bottom); }
  const pad = 60;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}" style="background:#111">`);
  for (const o of cap.obstacles) parts.push(`<rect x="${o.left}" y="${o.top}" width="${o.right - o.left}" height="${o.bottom - o.top}" fill="${o.id.startsWith("pocket") ? "none" : "#223"}" stroke="${o.id.startsWith("pocket") ? "#a5a" : "#557"}" stroke-width="2"/><text x="${o.left + 6}" y="${o.top + 16}" fill="#99a" font-size="12">${o.id.slice(0, 10)}</text>`);
  const colors = ["#f5b642", "#6f9cff", "#c78bff", "#4fd1a5", "#ff6f6f", "#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#f78c6b"];
  let ci = 0;
  for (const [id, r] of solved) {
    const c = colors[ci++ % colors.length];
    parts.push(`<polyline points="${r.points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${c}" stroke-width="3" opacity="0.9"><title>${id}</title></polyline>`);
  }
  for (const m of marks) parts.push(`<circle cx="${m.x}" cy="${m.y}" r="9" fill="none" stroke="#ff2222" stroke-width="3"/>`);
  parts.push("</svg>");
  const out = process.env.OUT ?? "router-audit.local.svg";
  writeFileSync(out, parts.join("\n"));
  console.log("svg", out);
});
