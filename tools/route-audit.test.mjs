import { describe, it, expect } from 'vitest';
import { auditRoutes } from './route-audit.mjs';
const route = (edgeId, points) => ({ edgeId, points: points.map(([x, y]) => ({ x, y })) });
const audit = (a, b) => auditRoutes([route('a', a), route('b', b)]);
describe('finished wire geometry audit', () => {
  it('counts a proper X', () => expect(audit([[0,0],[20,20]], [[0,20],[20,0]]).crossings).toBe(1));
  it('does not lose a crossing when a segment is subdivided', () => {
    const r = audit([[0,0],[10,10],[20,20]], [[0,20],[10,10],[20,0]]);
    expect(r.crossings).toBe(1); expect(r.strictSegmentCrossings).toBe(0);
  });
  it('counts a crossing at a bend when the paths pass through each other', () => expect(audit([[0,0],[10,10],[20,10]], [[10,0],[10,20]]).crossings).toBe(1));
  it('separates a tangential bend touch from a crossing', () => {
    const r = audit([[0,0],[10,10],[20,0]], [[0,10],[20,10]]);
    expect(r.crossings).toBe(0); expect(r.touches).toBe(1);
  });
  it('separates shared docks and T contacts', () => {
    expect(audit([[0,0],[10,0]], [[0,0],[0,10]]).sharedEnds).toBe(1);
    expect(audit([[0,0],[20,0]], [[10,0],[10,10]]).touches).toBe(1);
  });
  it('reports positive-length overlaps without inventing an X', () => {
    const r = audit([[0,0],[20,0]], [[10,0],[30,0]]);
    expect(r.crossings).toBe(0); expect(r.overlapSegments).toBe(1);
  });
  it('counts each separate crossing of the same pair', () => expect(audit([[0,0],[10,20],[20,0]], [[0,10],[20,10]]).crossings).toBe(2));
  it('ignores zero-length segments and measures Euclidean length', () => {
    const r = audit([[0,0],[0,0],[3,4]], [[20,0],[20,10]]);
    expect(r.length).toBe(15); expect(r.events).toHaveLength(0);
  });
});
