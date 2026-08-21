import { describe, expect, it } from "vitest";
import type { FactoryNode, FactoryPocket } from "./types";
import {
  collectPocketDescendantIds,
  computeBoardLevelView,
  computeOpenBoardRects,
  pickBoardOwnerFor,
} from "./board-windows";

function makePocket(
  id: string,
  overrides: Partial<FactoryPocket> = {},
): FactoryPocket {
  return { id, name: id, position: { x: 0, y: 0 }, ...overrides };
}

function makeNode(id: string, pocketId?: string): FactoryNode {
  return {
    id,
    recipeId: "recipe",
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    pocketId,
    position: { x: 0, y: 0 },
  };
}

describe("computeBoardLevelView", () => {
  it("hides members behind collapsed bars, the way pockets always did", () => {
    const pockets = [makePocket("p1"), makePocket("p2", { parentPocketId: "p1" })];
    const nodes = [makeNode("root-card"), makeNode("inner", "p1"), makeNode("deep", "p2")];
    const view = computeBoardLevelView({ nodes, pockets });

    expect(view.representativeOf("root-card")).toBe("root-card");
    expect(view.representativeOf("inner")).toBe("p1");
    expect(view.representativeOf("deep")).toBe("p1");
    expect(view.collapsedBoards.map((pocket) => pocket.id)).toEqual(["p1"]);
    expect(view.openBoards).toHaveLength(0);
  });

  it("shows an open board's members in place, at any depth of open chain", () => {
    const pockets = [
      makePocket("outer", { expanded: true }),
      makePocket("mid", { parentPocketId: "outer", expanded: true }),
      makePocket("closed", { parentPocketId: "mid" }),
    ];
    const nodes = [
      makeNode("in-outer", "outer"),
      makeNode("in-mid", "mid"),
      makeNode("in-closed", "closed"),
    ];
    const view = computeBoardLevelView({ nodes, pockets });

    // Members of open boards stand for themselves; the collapsed board
    // nested inside still hides its own behind its bar.
    expect(view.representativeOf("in-outer")).toBe("in-outer");
    expect(view.representativeOf("in-mid")).toBe("in-mid");
    expect(view.representativeOf("in-closed")).toBe("closed");
    expect(view.openBoards.map((pocket) => pocket.id)).toEqual(["outer", "mid"]);
    expect(view.collapsedBoards.map((pocket) => pocket.id)).toEqual(["closed"]);
  });

  it("a collapsed ancestor hides its open descendants entirely", () => {
    const pockets = [
      makePocket("shut"),
      makePocket("open-inside", { parentPocketId: "shut", expanded: true }),
    ];
    const nodes = [makeNode("member", "open-inside")];
    const view = computeBoardLevelView({ nodes, pockets });

    // The open board inside a shut one is not in view; the shut bar stands
    // for everything beneath it.
    expect(view.openBoards).toHaveLength(0);
    expect(view.collapsedBoards.map((pocket) => pocket.id)).toEqual(["shut"]);
    expect(view.representativeOf("member")).toBe("shut");
  });

  it("orders open boards parents before children for React Flow", () => {
    // Declared child-first to prove the sort does the work.
    const pockets = [
      makePocket("inner", { parentPocketId: "outer", expanded: true }),
      makePocket("outer", { expanded: true }),
    ];
    const view = computeBoardLevelView({ nodes: [], pockets });
    expect(view.openBoards.map((pocket) => pocket.id)).toEqual(["outer", "inner"]);
  });

  it("survives a cyclic parent chain without recursing forever", () => {
    const pockets = [
      makePocket("a", { parentPocketId: "b", expanded: true }),
      makePocket("b", { parentPocketId: "a", expanded: true }),
    ];
    const view = computeBoardLevelView({ nodes: [makeNode("x", "a")], pockets });
    expect(view.representativeOf("x")).toBeUndefined();
    expect(view.openBoards).toHaveLength(0);
  });
});

describe("computeOpenBoardRects", () => {
  it("accumulates nested frame positions into flow space", () => {
    const pockets = [
      makePocket("outer", { expanded: true, position: { x: 100, y: 200 }, size: { width: 800, height: 600 } }),
      makePocket("inner", {
        parentPocketId: "outer",
        expanded: true,
        position: { x: 40, y: 60 },
        size: { width: 300, height: 200 },
      }),
    ];
    const view = computeBoardLevelView({ nodes: [], pockets });
    const rects = computeOpenBoardRects(view.openBoards);

    expect(rects).toContainEqual({ id: "outer", depth: 1, x: 100, y: 200, width: 800, height: 600 });
    expect(rects).toContainEqual({ id: "inner", depth: 2, x: 140, y: 260, width: 300, height: 200 });
  });
});

describe("pickBoardOwnerFor", () => {
  const rects = [
    { id: "outer", depth: 1, x: 0, y: 0, width: 800, height: 600 },
    { id: "inner", depth: 2, x: 100, y: 100, width: 300, height: 200 },
  ];
  const card = (x: number, y: number) => ({ x, y, width: 60, height: 40 });

  it("lands in the deepest frame that holds the whole card", () => {
    expect(pickBoardOwnerFor(rects, card(200, 200))).toBe("inner");
    expect(pickBoardOwnerFor(rects, card(600, 300))).toBe("outer");
    expect(pickBoardOwnerFor(rects, card(900, 300))).toBeUndefined();
  });

  it("gives a straddling card to the room that holds all of it", () => {
    // Overhangs inner's right wall (100..400), so it stays outer's.
    expect(pickBoardOwnerFor(rects, card(360, 200))).toBe("outer");
    // Overhangs outer's right wall too: it belongs to no room.
    expect(pickBoardOwnerFor(rects, card(780, 300))).toBeUndefined();
  });

  it("treats the title bar as outside the floor", () => {
    // y = 120 is inside inner's title bar (100..140) but inside outer's floor.
    expect(pickBoardOwnerFor(rects, card(200, 120))).toBe("outer");
    // y = 20 is inside outer's own title bar: no owner at all.
    expect(pickBoardOwnerFor(rects, card(200, 20))).toBeUndefined();
  });

  it("skips excluded boards (a dragged board and its descendants)", () => {
    expect(pickBoardOwnerFor(rects, card(200, 200), new Set(["inner"]))).toBe("outer");
  });
});

describe("collectPocketDescendantIds", () => {
  it("collects the whole subtree", () => {
    const pockets = [
      makePocket("root"),
      makePocket("a", { parentPocketId: "root" }),
      makePocket("b", { parentPocketId: "a" }),
      makePocket("stranger"),
    ];
    expect(collectPocketDescendantIds(pockets, "root")).toEqual(new Set(["a", "b"]));
    expect(collectPocketDescendantIds(pockets, "b")).toEqual(new Set());
  });
});
