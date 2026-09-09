import { describe, expect, it } from "vitest";
import { decodeLayout, encodeLayout, parseLayout } from "./board-layout-string";

const project = {
  id: "plan-1",
  nodes: [
    { id: "node-aaaaaaaa-1111", position: { x: 140, y: 480 } },
    { id: "node-bbbbbbbb-2222", position: { x: 920, y: 380 } },
  ],
  storages: [{ id: "storage-cccccccc", position: { x: 0, y: 640 } }],
};

const snapshot = {
  planId: "plan-1",
  cards: [
    { id: "node-aaaaaaaa-1111", x: 140, y: 480, width: 440, height: 300 },
    { id: "node-bbbbbbbb-2222", x: 920, y: 380, width: 440, height: 500 },
    { id: "storage-cccccccc", x: 0, y: 640, width: 100, height: 80 },
  ],
  wires: [
    { source: "node-aaaaaaaa-1111", target: "node-bbbbbbbb-2222", sourcePortY: 140, targetPortY: 100, width: 6 },
    { source: "storage-cccccccc", target: "node-aaaaaaaa-1111", targetPortY: 60, width: 4 },
  ],
  score: { crossings: 3, length: 14972.4 },
};

describe("layout strings", () => {
  it("carries score, sizes and wires, and comes back the same", () => {
    const text = encodeLayout(snapshot);
    expect(text.length).toBeLessThan(260);
    const parsed = parseLayout(text);
    expect(parsed.planId).toBe("plan-1");
    expect(parsed.score).toEqual({ crossings: 3, length: 14972 });
    expect(parsed.cards).toEqual([
      { id: "node-aaa", x: 140, y: 480, width: 440, height: 300 },
      { id: "node-bbb", x: 920, y: 380, width: 440, height: 500 },
      { id: "storage-", x: 0, y: 640, width: 100, height: 80 },
    ]);
    expect(parsed.wires).toEqual([
      { id: "w0", source: "node-aaa", target: "node-bbb", sourcePortY: 140, targetPortY: 100, width: 6 },
      { id: "w1", source: "storage-", target: "node-aaa", sourcePortY: undefined, targetPortY: 60, width: 4 },
    ]);
  });

  it("applies to the plan it came from by id prefix", () => {
    const decoded = decodeLayout(encodeLayout(snapshot), project);
    expect(decoded.otherPlan).toBe(false);
    expect(decoded.unknown).toEqual([]);
    expect(decoded.missing).toEqual([]);
    expect(decoded.moves).toEqual([
      { id: "node-aaaaaaaa-1111", position: { x: 140, y: 480 } },
      { id: "node-bbbbbbbb-2222", position: { x: 920, y: 380 } },
      { id: "storage-cccccccc", position: { x: 0, y: 640 } },
    ]);
  });

  it("lengthens keys until every card is told apart", () => {
    const twins = {
      planId: "plan-2",
      cards: [
        { id: "node-same-prefix-A", x: 0, y: 0 },
        { id: "node-same-prefix-B", x: 500, y: 0 },
      ],
    };
    const parsed = parseLayout(encodeLayout(twins));
    expect(parsed.cards.map((card) => card.id)).toEqual(["node-same-prefix-A", "node-same-prefix-B"]);
    expect(parsed.cards.map((card) => card.x)).toEqual([0, 500]);
  });

  it("reports keys that match nothing and cards the layout leaves out, and still reads version 1", () => {
    const decoded = decodeLayout(
      JSON.stringify({ p: "other", v: 1, c: { "node-aaa": [1, 1], ghost: [0, 0] } }),
      project,
    );
    expect(decoded.otherPlan).toBe(true);
    expect(decoded.moves).toEqual([{ id: "node-aaaaaaaa-1111", position: { x: 20, y: 20 } }]);
    expect(decoded.unknown).toEqual(["ghost"]);
    expect(decoded.missing).toEqual(["node-bbbbbbbb-2222", "storage-cccccccc"]);
  });

  it("refuses text that is not a layout", () => {
    expect(() => parseLayout('{"v":3}')).toThrow();
  });
});
