import { describe, expect, it } from "vitest";
import { BOARD_GRID } from "@/lib/board-grid";
import {
  nearestFreeSpot,
  rectsOverlap,
  spotIsFree,
  type PlacementRect,
  type PlacementRegion,
} from "./board-placement";

const card = (x: number, y: number, width = 360, height = 160): PlacementRect => ({
  x,
  y,
  width,
  height,
});

describe("rectsOverlap", () => {
  it("counts shared area, not shared edges", () => {
    expect(rectsOverlap(card(0, 0), card(100, 0))).toBe(true);
    // Flush neighbours: the right edge of one is the left edge of the next.
    expect(rectsOverlap(card(0, 0), card(360, 0))).toBe(false);
    expect(rectsOverlap(card(0, 0), card(0, 160))).toBe(false);
  });

  it("keeps a gap when one is asked for", () => {
    expect(rectsOverlap(card(0, 0), card(360, 0), BOARD_GRID)).toBe(true);
    expect(rectsOverlap(card(0, 0), card(380, 0), BOARD_GRID)).toBe(false);
  });
});

describe("nearestFreeSpot", () => {
  it("leaves a drop that already fits exactly where it landed", () => {
    const spot = nearestFreeSpot(card(500, 500), [card(0, 0), card(1200, 700)]);
    expect(spot).toEqual({ x: 500, y: 500 });
  });

  it("slides a drop off the card it landed on", () => {
    const sitting = card(0, 0);
    // Dropped almost on top of it: two cells in.
    const spot = nearestFreeSpot(card(40, 40), [sitting]);
    expect(spot).not.toEqual({ x: 40, y: 40 });
    expect(rectsOverlap({ ...card(0, 0), ...spot }, sitting)).toBe(false);
    // On the grid, and near: the magnet nudges, it does not fling.
    expect(spot.x % BOARD_GRID).toBe(0);
    expect(spot.y % BOARD_GRID).toBe(0);
    expect(Math.abs(spot.x - 40) + Math.abs(spot.y - 40)).toBeLessThanOrEqual(200);
  });

  it("finds the gap between two cards rather than going around them", () => {
    // A 400-wide corridor between two cards; a 360-wide card fits in it.
    const left = card(0, 0, 360, 160);
    const right = card(760, 0, 360, 160);
    const spot = nearestFreeSpot(card(300, 0), [left, right]);
    expect(spot.y).toBe(0);
    expect(spot.x).toBeGreaterThanOrEqual(360);
    expect(spot.x + 360).toBeLessThanOrEqual(760);
  });

  it("escapes a packed lattice with no room between its cards", () => {
    // A wall of cards a cell apart: nothing fits between them, so the only
    // free ground is outside the block.
    const blockers: PlacementRect[] = [];
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        blockers.push(card(column * 380, row * 180));
      }
    }
    const spot = nearestFreeSpot(card(380, 180), blockers);
    const landed = { x: spot.x, y: spot.y, width: 360, height: 160 };
    expect(blockers.some((blocker) => rectsOverlap(landed, blocker))).toBe(false);
  });

  it("stays put rather than flinging a card across the plan", () => {
    // Walled in far past the magnet's reach: leaving the drop where the
    // hand put it beats teleporting it into the next county.
    const blockers: PlacementRect[] = [];
    for (let column = 0; column < 30; column += 1) {
      for (let row = 0; row < 30; row += 1) {
        blockers.push(card(column * 380, row * 180));
      }
    }
    expect(nearestFreeSpot(card(3800, 1800), blockers)).toEqual({ x: 3800, y: 1800 });
  });

  it("is deterministic: the same crowded drop always lands the same way", () => {
    const blockers = [card(0, 0), card(400, 0), card(0, 200)];
    const first = nearestFreeSpot(card(20, 20), blockers);
    const second = nearestFreeSpot(card(20, 20), [...blockers].reverse());
    expect(first).toEqual(second);
  });
});

describe("rooms a card is in or out of", () => {
  // A board 1000 wide from x = 500, its floor starting 40 below the top.
  const room: PlacementRegion = {
    outer: { x: 500, y: 0, width: 1000, height: 800 },
    inner: { x: 500, y: 40, width: 1000, height: 760 },
  };

  it("refuses a card lying across the wall", () => {
    // Half in, half out of the left wall.
    expect(spotIsFree(card(320, 200), [], 0, undefined, [room])).toBe(false);
    // Poking up into the title bar.
    expect(spotIsFree(card(600, 20), [], 0, undefined, [room])).toBe(false);
  });

  it("allows a card wholly inside or wholly outside", () => {
    expect(spotIsFree(card(600, 200), [], 0, undefined, [room])).toBe(true);
    expect(spotIsFree(card(100, 200), [], 0, undefined, [room])).toBe(true);
  });

  it("clicks a straddling card to the nearer side", () => {
    // Only its nose is over the wall: it backs out.
    const out = nearestFreeSpot(card(200, 200), [], 0, undefined, [room]);
    expect(out.x + 360).toBeLessThanOrEqual(500);
    // Most of it is already in the room: it finishes entering.
    const inside = nearestFreeSpot(card(400, 200), [], 0, undefined, [room]);
    expect(inside.x).toBeGreaterThanOrEqual(500);
  });
});
