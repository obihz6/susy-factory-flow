import { describe, expect, it } from "vitest";
import {
  EDGE_DETAIL_ARROWS,
  EDGE_DETAIL_GLOBAL,
  EDGE_DETAIL_LABELS,
  EDGE_DETAIL_PULSE,
  edgeDetailForLevel,
  hasEdgeDetail,
  reuseObjectIdentity,
} from "./edge-detail";
import {
  NODE_DETAIL_FULL,
  NODE_DETAIL_GLANCE,
  NODE_GLANCE_ENTER_ZOOM,
  NODE_GLANCE_LEAVE_ZOOM,
  getNodeDetailLevel,
} from "./node-detail";

describe("edgeDetailForLevel", () => {
  it("draws everything while the board is readable", () => {
    const detail = edgeDetailForLevel(NODE_DETAIL_FULL);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_ARROWS)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_LABELS)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_PULSE)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_GLOBAL)).toBe(false);
  });

  it("strips a line down to its route and its arrows at a glance", () => {
    // The chip is a few pixels tall here and the dashes are a shimmer - and
    // there are hundreds of each. The arrows stay, drawn larger.
    const detail = edgeDetailForLevel(NODE_DETAIL_GLANCE);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_GLOBAL)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_LABELS)).toBe(false);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_ARROWS)).toBe(true);
    expect(hasEdgeDetail(detail, EDGE_DETAIL_PULSE)).toBe(false);
  });

  it("switches lines at exactly the zoom the cards switch at", () => {
    // The bug this pins: nodes used a hysteretic threshold and edges a plain
    // one, so between them sat a band where the rate chips had come back but
    // the cards were still showing percentages. One level, one switch.
    const zoomedOut = getNodeDetailLevel(NODE_GLANCE_ENTER_ZOOM - 0.01, NODE_DETAIL_FULL);
    const zoomedIn = getNodeDetailLevel(NODE_GLANCE_LEAVE_ZOOM + 0.01, NODE_DETAIL_GLANCE);
    expect(zoomedOut).toBe(NODE_DETAIL_GLANCE);
    expect(zoomedIn).toBe(NODE_DETAIL_FULL);
    expect(hasEdgeDetail(edgeDetailForLevel(zoomedOut), EDGE_DETAIL_LABELS)).toBe(false);
    expect(hasEdgeDetail(edgeDetailForLevel(zoomedIn), EDGE_DETAIL_LABELS)).toBe(true);
  });
});

describe("getNodeDetailLevel", () => {
  it("holds its level inside the dead zone, from either side", () => {
    // Anti-flicker: parked between the thresholds, the board keeps whatever it
    // already had rather than strobing on sub-pixel zoom drift.
    const middle = (NODE_GLANCE_ENTER_ZOOM + NODE_GLANCE_LEAVE_ZOOM) / 2;
    expect(getNodeDetailLevel(middle, NODE_DETAIL_FULL)).toBe(NODE_DETAIL_FULL);
    expect(getNodeDetailLevel(middle, NODE_DETAIL_GLANCE)).toBe(NODE_DETAIL_GLANCE);
  });

  it("is stable across a zoom gesture that crosses no threshold", () => {
    expect(getNodeDetailLevel(1.0, NODE_DETAIL_FULL)).toBe(
      getNodeDetailLevel(1.4, NODE_DETAIL_FULL),
    );
    expect(getNodeDetailLevel(0.1, NODE_DETAIL_GLANCE)).toBe(
      getNodeDetailLevel(0.2, NODE_DETAIL_GLANCE),
    );
  });

  it("keeps its level when the zoom is not a usable number", () => {
    expect(getNodeDetailLevel(Number.NaN, NODE_DETAIL_GLANCE)).toBe(NODE_DETAIL_GLANCE);
    expect(getNodeDetailLevel(0, NODE_DETAIL_FULL)).toBe(NODE_DETAIL_FULL);
  });
});

describe("reuseObjectIdentity", () => {
  const recipe = { id: "recipe" };
  const node = { id: "node" };

  it("returns the same reference when nothing moved", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { node, recipe, result: undefined });
    const second = reuseObjectIdentity(cache, "a", { node, recipe, result: undefined });
    expect(second).toBe(first);
  });

  it("returns the new object when a field changes", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { node, recipe, result: undefined });
    const second = reuseObjectIdentity(cache, "a", { node, recipe, result: { utilization: 1 } });
    expect(second).not.toBe(first);
    expect(second.result).toEqual({ utilization: 1 });
  });

  it("compares by reference, not by value", () => {
    // A structurally equal but freshly built field is a real change to React, and
    // pretending otherwise would render stale data.
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { recipe: { id: "recipe" } });
    const second = reuseObjectIdentity(cache, "a", { recipe: { id: "recipe" } });
    expect(second).not.toBe(first);
  });

  it("keeps entries for different ids apart", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const a = reuseObjectIdentity(cache, "a", { node, recipe });
    const b = reuseObjectIdentity(cache, "b", { node, recipe });
    expect(b).not.toBe(a);
    expect(reuseObjectIdentity(cache, "a", { node, recipe })).toBe(a);
  });

  it("does not reuse when a field is removed", () => {
    const cache = new Map<string, Record<string, unknown>>();
    const first = reuseObjectIdentity(cache, "a", { node, recipe });
    const second = reuseObjectIdentity(cache, "a", { node });
    expect(second).not.toBe(first);
  });
});
