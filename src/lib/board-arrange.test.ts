import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTER_TUNING } from "@/components/flow/router-tuning";
import {
  arrangeBoard,
  arrangeBoardColumns,
  type ArrangeCard,
  type ArrangeMove,
  type ArrangeWire,
} from "./board-arrange";
import { BOARD_GRID } from "./board-grid";

function card(id: string, overrides: Partial<ArrangeCard> = {}): ArrangeCard {
  return { id, x: 0, y: 0, width: 360, height: 280, ...overrides };
}

function wire(source: string, target: string, extra: Partial<ArrangeWire> = {}): ArrangeWire {
  return { source, target, ...extra };
}

function positionsById(moves: ArrangeMove[]) {
  return new Map(moves.map((move) => [move.id, move.position]));
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function expectNoOverlaps(cards: ArrangeCard[], moves: ArrangeMove[]) {
  const byId = positionsById(moves);
  const rects = cards.map((c) => {
    const p = byId.get(c.id)!;
    return { id: c.id, x: p.x, y: p.y, width: c.width, height: c.height };
  });
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      expect(
        rectsOverlap(rects[i], rects[j]),
        `${rects[i].id} overlaps ${rects[j].id}`,
      ).toBe(false);
    }
  }
}

describe("arrangeBoard", () => {
  it("lays a chain out left to right on the grid", () => {
    const cards = [card("c", { x: 500, y: 900 }), card("a", { x: 40, y: 40 }), card("b")];
    const { moves } = arrangeBoard({ cards, wires: [wire("a", "b"), wire("b", "c")] });
    const p = positionsById(moves);

    expect(p.get("a")!.x).toBeLessThan(p.get("b")!.x);
    expect(p.get("b")!.x).toBeLessThan(p.get("c")!.x);
    for (const move of moves) {
      expect(move.position.x % BOARD_GRID).toBe(0);
      expect(move.position.y % BOARD_GRID).toBe(0);
    }
    expectNoOverlaps(cards, moves);
  });

  it("is deterministic, and independent of where the cards started", () => {
    const wires = [wire("a", "b"), wire("a", "c"), wire("b", "d"), wire("c", "d")];
    const near = [card("a"), card("b"), card("c"), card("d")];
    const scattered = [
      card("a", { x: 5000, y: -2000 }),
      card("b", { x: -400, y: 60 }),
      card("c", { x: 120, y: 8000 }),
      card("d", { x: 0, y: 0 }),
    ];

    const first = arrangeBoard({ cards: near, wires, origin: { x: 0, y: 0 } });
    const second = arrangeBoard({ cards: near, wires, origin: { x: 0, y: 0 } });
    const moved = arrangeBoard({ cards: scattered, wires, origin: { x: 0, y: 0 } });

    expect(second).toEqual(first);
    expect(moved).toEqual(first);
  });

  it("anchors the layout at the old bounding box by default", () => {
    const cards = [card("a", { x: 1000, y: 2000 }), card("b", { x: 1400, y: 2400 })];
    const { moves } = arrangeBoard({ cards, wires: [wire("a", "b")] });
    const p = positionsById(moves);
    expect(Math.min(p.get("a")!.x, p.get("b")!.x)).toBe(1000);
    expect(Math.min(p.get("a")!.y, p.get("b")!.y)).toBe(2000);
  });

  it("keeps separate islands apart", () => {
    const cards = [
      card("a1"),
      card("a2"),
      card("a3"),
      card("b1"),
      card("b2"),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a1", "a2"), wire("a2", "a3"), wire("b1", "b2")],
      origin: { x: 0, y: 0 },
    });
    const p = positionsById(moves);
    // Apart on SOME axis by a clear gap - side by side or stacked, either
    // way round, never interleaved.
    const box = (ids: string[]) => ({
      left: Math.min(...ids.map((id) => p.get(id)!.x)),
      right: Math.max(...ids.map((id) => p.get(id)!.x + 360)),
      top: Math.min(...ids.map((id) => p.get(id)!.y)),
      bottom: Math.max(...ids.map((id) => p.get(id)!.y + 280)),
    });
    const a = box(["a1", "a2", "a3"]);
    const b = box(["b1", "b2"]);
    const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
    expect(gap >= 100).toBe(true);
    expectNoOverlaps(cards, moves);
  });

  it("parks unwired cards on a shelf below everything", () => {
    const cards = [
      card("a"),
      card("b"),
      card("loose1", { width: 100, height: 80 }),
      card("loose2", { width: 100, height: 80 }),
    ];
    const { moves } = arrangeBoard({ cards, wires: [wire("a", "b")], origin: { x: 0, y: 0 } });
    const p = positionsById(moves);
    const wiredBottom = Math.max(p.get("a")!.y + 280, p.get("b")!.y + 280);
    expect(p.get("loose1")!.y).toBeGreaterThanOrEqual(wiredBottom);
    expect(p.get("loose2")!.y).toBeGreaterThanOrEqual(wiredBottom);
    expectNoOverlaps(cards, moves);
  });

  it("puts a buffer in its own column between producer and consumer", () => {
    const cards = [card("machineA"), card("tank", { width: 100, height: 80 }), card("machineB")];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("machineA", "tank"), wire("tank", "machineB")],
    });
    const p = positionsById(moves);
    expect(p.get("machineA")!.x + 360).toBeLessThan(p.get("tank")!.x);
    expect(p.get("tank")!.x + 100).toBeLessThan(p.get("machineB")!.x);
    expectNoOverlaps(cards, moves);
  });

  it("survives a recycle loop and keeps the majority direction", () => {
    // The column pass's rule (a cycle broken at its least wire, the rest
    // reading left to right); the free placement may fold a loop into a
    // triangle, which the router prices lower.
    const cards = [card("a"), card("b"), card("c")];
    const { moves } = arrangeBoardColumns({
      cards,
      wires: [wire("a", "b"), wire("b", "c"), wire("c", "a")],
    });
    const p = positionsById(moves);
    expect(p.get("a")!.x).toBeLessThan(p.get("b")!.x);
    expect(p.get("b")!.x).toBeLessThan(p.get("c")!.x);
  });

  it("stacks a fan-out without overlaps", () => {
    const consumers = ["c1", "c2", "c3", "c4", "c5"].map((id, i) =>
      card(id, { height: 200 + i * 40 }),
    );
    const cards = [card("hub"), ...consumers];
    const { moves } = arrangeBoard({
      cards,
      wires: consumers.map((c) => wire("hub", c.id)),
    });
    expectNoOverlaps(cards, moves);
    const p = positionsById(moves);
    for (const consumer of consumers) {
      expect(p.get("hub")!.x + 360).toBeLessThan(p.get(consumer.id)!.x);
    }
  });

  it("lines measured ports up straight across a wire", () => {
    const cards = [card("maker"), card("eater")];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("maker", "eater", { sourcePortY: 100, targetPortY: 60 })],
    });
    const p = positionsById(moves);
    expect(p.get("maker")!.y + 100).toBe(p.get("eater")!.y + 60);
  });

  it("moves ink with the cards it was written over, and leaves far ink alone", () => {
    const cards = [card("a", { x: 0, y: 0 }), card("b", { x: 0, y: 1000 })];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "b")],
      origin: { x: 2000, y: 2000 },
      ink: [
        { id: "note-on-a", x: 40, y: 40, width: 240, height: 80 },
        { id: "floater", x: 9000, y: 9000, width: 240, height: 80 },
      ],
    });
    const p = positionsById(moves);
    const deltaX = p.get("a")!.x - 0;
    const deltaY = p.get("a")!.y - 0;
    expect(p.get("note-on-a")).toEqual({ x: 40 + deltaX, y: 40 + deltaY });
    expect(p.has("floater")).toBe(false);
  });

  it("separates feeder sections with extra air around the trunk", () => {
    // Three two-card feeder chains join B: one becomes the trunk, the other
    // two are sections, so where they share a column the gaps must be
    // section-sized, not row-sized.
    const cards = [
      card("a1"),
      card("a2"),
      card("x1"),
      card("x2"),
      card("y1"),
      card("y2"),
      card("b"),
      card("c"),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [
        wire("a1", "a2"),
        wire("a2", "b"),
        wire("x1", "x2"),
        wire("x2", "b"),
        wire("y1", "y2"),
        wire("y2", "b"),
        wire("b", "c"),
      ],
    });
    const p = positionsById(moves);
    const columnYs = ["a2", "x2", "y2"]
      .map((id) => p.get(id)!.y)
      .sort((left, right) => left - right);
    expect(columnYs[1] - (columnYs[0] + 280)).toBeGreaterThanOrEqual(60);
    expect(columnYs[2] - (columnYs[1] + 280)).toBeGreaterThanOrEqual(60);
    expectNoOverlaps(cards, moves);
  });

  it("tucks a lone byproduct drawer in beside its machine as a bud", () => {
    const cards = [
      card("a"),
      card("b"),
      card("c"),
      card("slag-drawer", { width: 100, height: 80 }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "b"), wire("b", "c"), wire("b", "slag-drawer")],
    });
    const p = positionsById(moves);
    const centreB = p.get("b")!.y + 140;
    const centreDrawer = p.get("slag-drawer")!.y + 40;
    expect(Math.abs(centreDrawer - centreB)).toBeLessThan(300);
    expectNoOverlaps(cards, moves);
  });

  it("keeps a recycle loop tight beside its section", () => {
    const cards = [card("a"), card("m2"), card("b"), card("m6", { height: 200 })];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "m2"), wire("m2", "b"), wire("m2", "m6"), wire("m6", "m2")],
    });
    const p = positionsById(moves);
    const centre = (id: string, height: number) => p.get(id)!.y + height / 2;
    expect(Math.abs(centre("m6", 200) - centre("m2", 280))).toBeLessThan(400);
    expectNoOverlaps(cards, moves);
  });

  it("lets the heavier wire hold the straighter line", () => {
    const cards = [card("hub"), card("heavy"), card("light")];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("hub", "heavy", { weight: 10 }), wire("hub", "light", { weight: 1 })],
    });
    const p = positionsById(moves);
    const centre = (id: string) => p.get(id)!.y + 140;
    expect(Math.abs(centre("hub") - centre("heavy"))).toBeLessThanOrEqual(
      Math.abs(centre("hub") - centre("light")),
    );
  });

  it("puts a bud on the side its wire leaves from, instead of crossing the trunk", () => {
    // The drawer is fed from a port at the BOTTOM of t1 while the trunk wire
    // leaves the middle, so the drawer belongs below the trunk line: leaving
    // it above would drag its wire across the t1-to-t2 run.
    const cards = [card("t1"), card("t2"), card("t3"), card("d", { width: 100, height: 80 })];
    const { moves } = arrangeBoard({
      cards,
      wires: [
        wire("t1", "t2", { sourcePortY: 140, targetPortY: 140 }),
        wire("t2", "t3", { sourcePortY: 140, targetPortY: 140 }),
        wire("t1", "d", { sourcePortY: 260, targetPortY: 40 }),
      ],
    });
    const p = positionsById(moves);
    expect(p.get("d")!.y).toBeGreaterThan(p.get("t2")!.y);
    expectNoOverlaps(cards, moves);
  });

  it("pins a lone supply drawer against its machine's left edge", () => {
    const cards = [
      card("machine"),
      card("supply", { width: 100, height: 80, role: "storage" }),
      card("next"),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("supply", "machine", { targetPortY: 140 }), wire("machine", "next")],
    });
    const p = positionsById(moves);
    const gap = p.get("machine")!.x - (p.get("supply")!.x + 100);
    expect(gap).toBeGreaterThanOrEqual(20);
    expect(gap).toBeLessThanOrEqual(120);
    // Vertically it sits at the port it feeds, inside the machine's height.
    expect(p.get("supply")!.y).toBeGreaterThanOrEqual(p.get("machine")!.y);
    expect(p.get("supply")!.y).toBeLessThan(p.get("machine")!.y + 280);
  });

  it("pins a catch drawer against its machine's right edge", () => {
    const cards = [
      card("prev"),
      card("machine"),
      card("catch", { width: 100, height: 80, role: "storage" }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("prev", "machine"), wire("machine", "catch", { sourcePortY: 220 })],
    });
    const p = positionsById(moves);
    const gap = p.get("catch")!.x - (p.get("machine")!.x + 360);
    expect(gap).toBeGreaterThanOrEqual(20);
    expect(gap).toBeLessThanOrEqual(120);
  });

  it("puts a drawer shared by two machines between them", () => {
    const cards = [
      card("a"),
      card("mid"),
      card("b"),
      card("shared", { width: 100, height: 80, role: "storage" }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [wire("a", "mid"), wire("mid", "b"), wire("a", "shared"), wire("b", "shared")],
    });
    const p = positionsById(moves);
    expect(p.get("shared")!.x).toBeGreaterThan(p.get("a")!.x);
    expect(p.get("shared")!.x).toBeLessThan(p.get("b")!.x + 360);
    expectNoOverlaps(cards, moves);
  });

  it("folds a long recycle ring into a loop instead of a line", () => {
    const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const cards = ids.map((id) => card(id));
    const { moves } = arrangeBoard({
      cards,
      wires: ids.map((id, i) => wire(id, ids[(i + 1) % ids.length])),
      origin: { x: 0, y: 0 },
    });
    const p = positionsById(moves);
    const width = Math.max(...ids.map((id) => p.get(id)!.x + 360));
    // A six-card chain would run ~2500px; the fold halves it.
    expect(width).toBeLessThan(1800);
    // The closure wire is a hop, not a lasso.
    expect(Math.abs(p.get("r6")!.x - p.get("r1")!.x)).toBeLessThan(500);
    expectNoOverlaps(cards, moves);
  });

  it("keeps a pass-through buffer inside its island", () => {
    const cards = [
      card("a1"),
      card("a2"),
      card("a3"),
      card("a4"),
      card("pass", { width: 100, height: 80, role: "storage" }),
      card("b1"),
      card("b2"),
      card("b3"),
      card("b4"),
    ];
    const result = arrangeBoard({
      cards,
      wires: [
        wire("a1", "a2"),
        wire("a2", "a3"),
        wire("a3", "a4"),
        wire("a4", "pass"),
        wire("pass", "b1"),
        wire("b1", "b2"),
        wire("b2", "b3"),
        wire("b3", "b4"),
      ],
      origin: { x: 0, y: 0 },
    });
    // Two islands only: the buffer serves ONE other island, so it stays in.
    expect(result.islands.filter((island) => !island.backdrop)).toHaveLength(0);
  });

  it("taste: snug spacing packs tighter than airy", () => {
    const cards = [card("a"), card("x1"), card("x2"), card("b"), card("c")];
    const wires = [wire("a", "b"), wire("x1", "x2"), wire("x2", "b"), wire("b", "c")];
    const area = (taste: { spacing: "compact" | "roomy" }) => {
      const { moves } = arrangeBoard({ cards, wires, origin: { x: 0, y: 0 }, taste });
      let maxX = 0;
      let maxY = 0;
      for (const move of moves) {
        maxX = Math.max(maxX, move.position.x + 360);
        maxY = Math.max(maxY, move.position.y + 280);
      }
      return maxX * maxY;
    };
    expect(area({ spacing: "compact" })).toBeLessThan(area({ spacing: "roomy" }));
  });

  it("handles an empty board and wires to missing cards", () => {
    expect(arrangeBoard({ cards: [], wires: [wire("x", "y")] }).moves).toEqual([]);
    const { moves } = arrangeBoard({ cards: [card("a")], wires: [wire("a", "ghost")] });
    expect(moves).toHaveLength(1);
  });

  it("keeps a tightly coupled web as one island", () => {
    // The same shape wired back so every big-enough split would cut three
    // or more wires: it stays together.
    const cards = [
      card("a"),
      card("b"),
      card("c"),
      card("d"),
      card("e"),
      card("e2"),
      card("f"),
      card("g"),
    ];
    const result = arrangeBoard({
      cards,
      wires: [
        wire("a", "b"),
        wire("b", "c"),
        wire("c", "d"),
        wire("e", "f"),
        wire("e2", "f"),
        wire("f", "g"),
        wire("g", "b"),
        wire("g", "c"),
        wire("e", "a"),
        wire("e2", "d"),
      ],
      origin: { x: 0, y: 0 },
    });
    expect(result.islands).toHaveLength(1);
  });

  it("stands each bypass buffer between its own two machines", () => {
    // Two buffers bypassing different spans of one trunk must each sit in
    // their own span's column, not stacked together beside one machine.
    const cards = [
      card("t1"),
      card("t2"),
      card("t3"),
      card("t4"),
      card("b1", { width: 100, height: 80, role: "storage" }),
      card("b2", { width: 100, height: 80, role: "storage" }),
    ];
    const { moves } = arrangeBoard({
      cards,
      wires: [
        wire("t1", "t2"),
        wire("t2", "t3"),
        wire("t3", "t4"),
        wire("t1", "b1"),
        wire("b1", "t3"),
        wire("t2", "b2"),
        wire("b2", "t4"),
      ],
      origin: { x: 0, y: 0 },
    });
    const p = positionsById(moves);
    expect(p.get("b1")!.x).toBeGreaterThan(p.get("t1")!.x + 360);
    expect(p.get("b1")!.x + 100).toBeLessThan(p.get("t3")!.x);
    expect(p.get("b2")!.x).toBeGreaterThan(p.get("t2")!.x + 360);
    expect(p.get("b2")!.x + 100).toBeLessThan(p.get("t4")!.x);
    expect(p.get("b1")!.x).not.toBe(p.get("b2")!.x);
    expectNoOverlaps(cards, moves);
  });

});

describe("emergent islands", () => {
  // One hub feeds two dense clusters of four. Nothing names either cluster
  // an island: the clusters part because their cards are strangers to each
  // other (three or more hops apart) and strangers owe each other air. With
  // the dial at zero the same board packs tight.
  const cards = [
    card("hub"),
    card("a1"),
    card("a2"),
    card("a3"),
    card("a4"),
    card("b1"),
    card("b2"),
    card("b3"),
    card("b4"),
  ];
  const wires = [
    wire("hub", "a1"),
    wire("a1", "a2"),
    wire("a1", "a3"),
    wire("a2", "a4"),
    wire("a3", "a4"),
    wire("hub", "b1"),
    wire("b1", "b2"),
    wire("b1", "b3"),
    wire("b2", "b4"),
    wire("b3", "b4"),
  ];
  const gapBetween = (moves: ArrangeMove[]) => {
    const p = positionsById(moves);
    const box = (ids: string[]) => ({
      left: Math.min(...ids.map((id) => p.get(id)!.x)),
      right: Math.max(...ids.map((id) => p.get(id)!.x + 360)),
      top: Math.min(...ids.map((id) => p.get(id)!.y)),
      bottom: Math.max(...ids.map((id) => p.get(id)!.y + 280)),
    });
    const a = box(["a1", "a2", "a3", "a4"]);
    const b = box(["b1", "b2", "b3", "b4"]);
    return Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
  };

  it("two clusters off one hub stand apart from each other", () => {
    const result = arrangeBoard({ cards, wires, origin: { x: 0, y: 0 } });
    expectNoOverlaps(cards, result.moves);
    expect(gapBetween(result.moves)).toBeGreaterThanOrEqual(4 * BOARD_GRID);
  });

  it("with the air dial at zero the same board packs tighter", () => {
    const airy = arrangeBoard({ cards, wires, origin: { x: 0, y: 0 } });
    const tight = arrangeBoard({
      cards,
      wires,
      origin: { x: 0, y: 0 },
      tuning: { ...DEFAULT_ROUTER_TUNING, islandAir: 0 },
    });
    expectNoOverlaps(cards, tight.moves);
    expect(gapBetween(tight.moves)).toBeLessThan(gapBetween(airy.moves));
  });
});
