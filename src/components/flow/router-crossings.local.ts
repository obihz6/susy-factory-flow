/**
 * Local-only helper for router auditing tests.
 * These tests run with CAPTURE=... and are not part of the CI suite.
 */
import type { GridPoint, GridRoutedEdge, GridSolveStats } from "./grid-edge-router";

export function totalCrossings(solved: Map<string, GridRoutedEdge>, stats?: GridSolveStats): number {
  if (stats) return stats.crossings;
  let total = 0;
  for (const r of solved.values()) {
    total += 0; // Router counts are in stats, not on the edge
  }
  return total;
}

export function geometricCrossings(
  solved: Map<string, GridRoutedEdge>
): Map<string, number> {
  const per = new Map<string, number>();
  const segs: Array<{ id: string; a: GridPoint; b: GridPoint }> = [];
  for (const [id, r] of solved) {
    for (let i = 0; i + 1 < r.points.length; i += 1) {
      segs.push({ id, a: r.points[i], b: r.points[i + 1] });
    }
  }
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const s = segs[i], t = segs[j];
      if (s.id === t.id) continue;
      // Full geometric intersection test using cross product method
      const d1 = cross(s.a, s.b, t.a);
      const d2 = cross(s.a, s.b, t.b);
      const d3 = cross(t.a, t.b, s.a);
      const d4 = cross(t.a, t.b, s.b);
      const eps = 0.5;
      if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
          ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
        const ux = s.b.x - s.a.x, uy = s.b.y - s.a.y;
        const vx = t.b.x - t.a.x, vy = t.b.y - t.a.y;
        const den = ux * vy - uy * vx;
        if (Math.abs(den) > 1e-10) {
          const tt = ((t.a.x - s.a.x) * vy - (t.a.y - s.a.y) * vx) / den;
          per.set(s.id, (per.get(s.id) ?? 0) + 1);
          per.set(t.id, (per.get(t.id) ?? 0) + 1);
        }
      }
    }
  }
  return per;
}

function cross(o: GridPoint, a: GridPoint, b: GridPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
