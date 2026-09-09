// Independent geometry audit of FINISHED polylines. No router occupancy or
// routing costs participate. Each event names its two wires and its position.
const EPS = 1e-6;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function raysAt(points, p) {
  const rays = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], v = sub(b, a), w = sub(p, a);
    const length = distance(a, b);
    if (length < EPS || Math.abs(cross(v, w)) > EPS * length) continue;
    const t = (w.x * v.x + w.y * v.y) / (length * length);
    if (t < -EPS || t > 1 + EPS) continue;
    for (const q of [a, b]) if (distance(p, q) > EPS) {
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      if (!rays.some((r) => Math.abs(Math.atan2(Math.sin(r - angle), Math.cos(r - angle))) < EPS)) rays.push(angle);
    }
  }
  return rays;
}

function crossesAt(a, b, p) {
  const ar = raysAt(a, p), br = raysAt(b, p);
  // Two continuing paths cross iff their four outgoing rays alternate
  // around the intersection. A bend touching and turning back is a touch.
  if (ar.length !== 2 || br.length !== 2) return false;
  const rays = [...ar.map((angle) => ({ angle, owner: 0 })), ...br.map((angle) => ({ angle, owner: 1 }))].sort((a, b) => a.angle - b.angle);
  return rays.every((r, i) => {
    const next = rays[(i + 1) % 4];
    return r.owner !== next.owner && Math.abs(Math.atan2(Math.sin(r.angle - next.angle), Math.cos(r.angle - next.angle))) > EPS;
  });
}

export function auditRoutes(routes) {
  const events = [];
  let length = 0, strictSegmentCrossings = 0;
  for (const r of routes) for (let i = 1; i < r.points.length; i++) length += distance(r.points[i - 1], r.points[i]);
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const a = routes[i], b = routes[j], contacts = [], overlaps = [];
    for (let ai = 1; ai < a.points.length; ai++) for (let bi = 1; bi < b.points.length; bi++) {
      const p = a.points[ai - 1], q = b.points[bi - 1];
      const u = sub(a.points[ai], p), v = sub(b.points[bi], q), w = sub(q, p);
      const ul = Math.hypot(u.x, u.y), vl = Math.hypot(v.x, v.y);
      if (ul < EPS || vl < EPS) continue;
      const den = cross(u, v);
      if (Math.abs(den) < EPS * ul * vl) {
        if (Math.abs(cross(w, u)) > EPS * ul) continue;
        const t0 = (w.x * u.x + w.y * u.y) / (ul * ul);
        const t1 = t0 + (v.x * u.x + v.y * u.y) / (ul * ul);
        const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
        if ((hi - lo) * ul > EPS) overlaps.push({ point: { x: p.x + lo * u.x, y: p.y + lo * u.y }, end: { x: p.x + hi * u.x, y: p.y + hi * u.y } });
        continue;
      }
      const t = cross(w, v) / den, s = cross(w, u) / den;
      if (t < -EPS || t > 1 + EPS || s < -EPS || s > 1 + EPS) continue;
      if (t > EPS && t < 1 - EPS && s > EPS && s < 1 - EPS) strictSegmentCrossings++;
      const point = { x: p.x + t * u.x, y: p.y + t * u.y };
      if (!contacts.some((c) => distance(c, point) < EPS)) contacts.push(point);
    }
    for (const point of contacts) {
      // Overlap ends are described by the overlap, not extra touches.
      if (overlaps.some((o) => Math.abs(distance(o.point, point) + distance(point, o.end) - distance(o.point, o.end)) < EPS)) continue;
      const sharedEnd = [a.points[0], a.points.at(-1)].some((p) => distance(p, point) < EPS) && [b.points[0], b.points.at(-1)].some((p) => distance(p, point) < EPS);
      events.push({ kind: sharedEnd ? 'shared-end' : crossesAt(a.points, b.points, point) ? 'crossing' : 'touch', edges: [a.edgeId, b.edgeId], point });
    }
    for (const overlap of overlaps) events.push({ kind: 'overlap', edges: [a.edgeId, b.edgeId], ...overlap });
  }
  events.sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x || a.edges.join().localeCompare(b.edges.join()));
  events.forEach((e, i) => { e.id = i + 1; });
  return { wireCount: routes.length, length, strictSegmentCrossings, crossings: events.filter((e) => e.kind === 'crossing').length, touches: events.filter((e) => e.kind === 'touch').length, overlapSegments: events.filter((e) => e.kind === 'overlap').length, sharedEnds: events.filter((e) => e.kind === 'shared-end').length, events };
}
