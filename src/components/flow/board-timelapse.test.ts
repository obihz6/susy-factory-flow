import { describe, expect, it } from "vitest";
import type {
  FactoryAnnotation,
  FactoryEdge,
  FactoryNode,
  FactoryPocket,
  FactoryStorage,
} from "@/lib/model/types";
import { buildTimelapseScript } from "./board-timelapse";

function node(id: string, x: number, y: number, pocketId?: string): FactoryNode {
  return {
    id,
    recipeId: `recipe-${id}`,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    pocketId,
    position: { x, y },
  };
}

function storage(id: string, x: number, y: number, pocketId?: string): FactoryStorage {
  return { id, kind: "item", resourceId: "item:test", pocketId, position: { x, y } };
}

function edge(id: string, source: string, target: string): FactoryEdge {
  return { id, source, target, resourceKind: "item", resourceId: "item:test" };
}

function pocket(id: string, x: number, y: number, expanded?: boolean): FactoryPocket {
  return {
    id,
    name: id,
    position: { x, y },
    expanded,
    size: expanded ? { width: 400, height: 300 } : undefined,
  };
}

function annotation(id: string, x: number, y: number): FactoryAnnotation {
  return {
    id,
    kind: "text",
    position: { x, y },
    size: { width: 100, height: 40 },
  } as FactoryAnnotation;
}

const revealedOrder = (script: ReturnType<typeof buildTimelapseScript>) =>
  script.beats.flatMap((beat) => beat.nodeIds);

describe("buildTimelapseScript", () => {
  it("sweeps down a chain: each machine is led in by its feeder's wire", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("b", 400, 0), node("c", 800, 0)],
      edges: [edge("ab", "a", "b"), edge("bc", "b", "c")],
    });

    expect(revealedOrder(script)).toEqual(["a", "b", "c"]);
    expect(script.beats.map((beat) => beat.kind)).toEqual([
      "card",
      "wire",
      "card",
      "wire",
      "card",
    ]);
    expect(script.beats.map((beat) => beat.edgeIds)).toEqual([[], ["ab"], [], ["bc"], []]);
    expect(script.beats[2].popNodeIds).toEqual(["b"]);
    expect(script.beats[4].popNodeIds).toEqual(["c"]);
  });

  it("walks downstream even when the sink sits nearer the source than a feeder", () => {
    // d consumes both a and c; c consumes a. Feeder-completeness outranks
    // distance, so c comes before d however the cards are placed.
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("d", 100, 0), node("c", 900, 0)],
      edges: [edge("ad", "a", "d"), edge("ac", "a", "c"), edge("cd", "c", "d")],
    });

    expect(revealedOrder(script)).toEqual(["a", "c", "d"]);
    // c is led in by its feeder's wire; d by its first, and its second
    // input docks as its own beat after the pop.
    expect(script.beats.map((beat) => beat.kind)).toEqual([
      "card",
      "wire",
      "card",
      "wire",
      "card",
      "wire",
    ]);
    expect(script.beats[3].edgeIds).toEqual(["ad"]);
    expect(script.beats[5].edgeIds).toEqual(["cd"]);
  });

  it("still finishes a plan whose graph is one big cycle", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("b", 400, 0)],
      edges: [edge("ab", "a", "b"), edge("ba", "b", "a")],
    });

    expect(revealedOrder(script).sort()).toEqual(["a", "b"]);
    expect(script.beats.flatMap((beat) => beat.edgeIds).sort()).toEqual(["ab", "ba"]);
  });

  it("draws an open board's frame only after everything in it is on the table", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("m", 40, 60, "board")],
      storages: [],
      pockets: [pocket("board", 600, 0, true)],
      edges: [edge("am", "a", "m")],
    });

    expect(script.beats.map((beat) => ({ kind: beat.kind, nodeIds: beat.nodeIds }))).toEqual([
      { kind: "card", nodeIds: ["a"] },
      { kind: "wire", nodeIds: ["m"] },
      { kind: "card", nodeIds: [] },
      { kind: "board", nodeIds: ["board"] },
    ]);
    expect(script.beats[1].edgeIds).toEqual(["am"]);
  });

  it("treats a collapsed board as one unit standing for its members", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("m1", 40, 60, "board"), node("m2", 40, 120, "board")],
      pockets: [pocket("board", 600, 0, false)],
      edges: [edge("am1", "a", "m1"), edge("am2", "a", "m2"), edge("mm", "m1", "m2")],
    });

    expect(revealedOrder(script)).toEqual(["a", "board"]);
    // Each crossing wire is its own beat; the internal one rides the last
    // beat as a stray so nothing stays hidden.
    const wireBeats = script.beats.filter((beat) => beat.kind === "wire");
    expect(wireBeats.length).toBe(2);
    expect(wireBeats.flatMap((beat) => beat.edgeIds).sort()).toEqual(["am1", "am2", "mm"]);
  });

  it("pops all the ink at once at the end, then leaves a beat for the pull-back", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("b", 400, 0)],
      annotations: [annotation("note-low", 0, 500), annotation("note-high", 0, -100)],
      edges: [edge("ab", "a", "b")],
    });

    const inkBeats = script.beats.filter((beat) => beat.kind === "ink");
    expect(inkBeats.length).toBe(1);
    expect([...inkBeats[0].nodeIds].sort()).toEqual(["note-high", "note-low"]);
    expect(inkBeats[0].popNodeIds).toEqual(inkBeats[0].nodeIds);
    // The curtain: the last beat is empty, so the finale's pull-back is its
    // own moment after the ink has landed.
    const last = script.beats[script.beats.length - 1];
    expect(last).toMatchObject({ nodeIds: [], edgeIds: [], kind: "card" });
    expect(script.beats.map((beat) => beat.kind)).toEqual([
      "card",
      "wire",
      "card",
      "ink",
      "card",
    ]);
  });

  it("builds each island to completion, biggest first", () => {
    // The big island sits far right, the small one at the origin - size
    // outranks position, and nothing interleaves.
    const script = buildTimelapseScript({
      nodes: [
        node("small1", 0, 0),
        node("small2", 400, 0),
        node("big1", 3000, 0),
        node("big2", 3400, 0),
        node("big3", 3800, 0),
      ],
      edges: [
        edge("s12", "small1", "small2"),
        edge("b12", "big1", "big2"),
        edge("b23", "big2", "big3"),
      ],
    });

    expect(revealedOrder(script)).toEqual(["big1", "big2", "big3", "small1", "small2"]);
  });

  it("summons a drawer: its wire draws over, then it pops in", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0)],
      storages: [storage("drawer", 400, 0)],
      edges: [edge("ad", "a", "drawer")],
    });

    expect(revealedOrder(script)).toEqual(["a", "drawer"]);
    expect(script.beats[1]).toMatchObject({
      nodeIds: ["drawer"],
      edgeIds: ["ad"],
      kind: "wire",
      focusNodeIds: ["drawer"],
    });
    expect(script.beats[2].popNodeIds).toEqual(["drawer"]);
  });

  it("lands a loose drawer with a plain pop, nothing to draw toward it", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("b", 400, 0)],
      storages: [storage("loose", 900, 0)],
      edges: [edge("ab", "a", "b")],
    });

    const last = script.beats[script.beats.length - 1];
    expect(last).toMatchObject({
      nodeIds: ["loose"],
      edgeIds: [],
      kind: "card",
      popNodeIds: ["loose"],
    });
    // The loose drawer is its own island - the coda's own scene.
    expect(last.sceneIndex).toBe(1);
    expect(script.scenes).toEqual([["a", "b"], ["loose"]]);
  });

  it("never lets a source lead: the machine lands, then its source spins in wired", () => {
    // The source drawer sits left of and above the machine - reading order
    // would pick it first; the machine-first rule must not.
    const script = buildTimelapseScript({
      nodes: [node("m", 800, 400)],
      storages: [storage("src", 0, 0)],
      edges: [edge("sm", "src", "m")],
    });

    // The machine lands, the wire draws OVER to where the source will sit
    // (the source mounts pending on the wire's beat), then the source pops.
    expect(
      script.beats.map((beat) => ({
        kind: beat.kind,
        nodeIds: beat.nodeIds,
        popNodeIds: beat.popNodeIds ?? [],
      })),
    ).toEqual([
      { kind: "card", nodeIds: ["m"], popNodeIds: ["m"] },
      { kind: "wire", nodeIds: ["src"], popNodeIds: [] },
      { kind: "card", nodeIds: [], popNodeIds: ["src"] },
    ]);
    expect(script.beats[1].edgeIds).toEqual(["sm"]);
  });

  it("treats a custom-rate card as an attendant, not a machine", () => {
    const script = buildTimelapseScript({
      nodes: [
        { ...node("supply", 0, 0), customRate: { perSecond: 10, mode: "supply" } },
        node("m", 800, 400),
      ],
      edges: [edge("sm", "supply", "m")],
    });

    expect(revealedOrder(script)).toEqual(["m", "supply"]);
    expect(script.beats[1].edgeIds).toEqual(["sm"]);
  });

  it("spins sources in before products, then wires the next machine to the buffer", () => {
    // A feeds buffer b; b feeds B. B's whole upstream is A (through the
    // buffer), so A goes first with b as its product attendant; B then
    // lands and docks onto the existing buffer as its own wire beat.
    const script = buildTimelapseScript({
      nodes: [node("A", 0, 0), node("B", 900, 0)],
      storages: [storage("b", 450, 0), storage("srcA", 0, 300)],
      edges: [edge("sA", "srcA", "A"), edge("Ab", "A", "b"), edge("bB", "b", "B")],
    });

    expect(
      script.beats.map((beat) => ({ kind: beat.kind, nodeIds: beat.nodeIds, edgeIds: beat.edgeIds })),
    ).toEqual([
      { kind: "card", nodeIds: ["A"], edgeIds: [] },
      { kind: "wire", nodeIds: ["srcA"], edgeIds: ["sA"] },
      { kind: "card", nodeIds: [], edgeIds: [] },
      { kind: "wire", nodeIds: ["b"], edgeIds: ["Ab"] },
      { kind: "card", nodeIds: [], edgeIds: [] },
      // B is a machine already wired to the standing buffer, so IT is
      // summoned too: the buffer's wire sweeps over, then B pops.
      { kind: "wire", nodeIds: ["B"], edgeIds: ["bB"] },
      { kind: "card", nodeIds: [], edgeIds: [] },
    ]);
    // The attendants and the summoned machine pop after their wire arrives.
    expect(script.beats[2].popNodeIds).toEqual(["srcA"]);
    expect(script.beats[4].popNodeIds).toEqual(["b"]);
    expect(script.beats[6].popNodeIds).toEqual(["B"]);
  });

  it("stands a nested empty board before the parent waiting on it", () => {
    const script = buildTimelapseScript({
      nodes: [node("a", 0, 0), node("m", 40, 60, "outer")],
      pockets: [
        pocket("outer", 600, 0, true),
        { ...pocket("inner", 40, 200, true), parentPocketId: "outer" },
      ],
      edges: [],
    });

    const boardBeats = script.beats.filter((beat) => beat.kind === "board");
    expect(boardBeats.map((beat) => beat.nodeIds)).toEqual([["inner"], ["outer"]]);
    // The member card still came before either frame.
    expect(revealedOrder(script).indexOf("m")).toBeLessThan(
      revealedOrder(script).indexOf("inner"),
    );
  });
});
