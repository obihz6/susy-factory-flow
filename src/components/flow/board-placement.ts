import { BOARD_GRID } from "@/lib/board-grid";

/**
 * The placement magnet: nothing sits on top of anything else.
 *
 * Cards, drawers, bins and board frames are FURNITURE — solid objects on a
 * shared surface — so a drop that would land one on top of another slides it
 * to the nearest free cell instead. Annotations are ink and are deliberately
 * exempt: a note pinned over a machine and a box drawn around a cluster are
 * both the point of them.
 *
 * Everything here is a pure function of rectangles in one coordinate space;
 * the caller resolves board-relative positions into flow space first.
 */

export interface PlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A room a card is either IN or OUT of, never half of each.
 *
 * A board is a place, not a decoration: a card lying across its wall
 * belongs to neither side and reads as a mistake. `outer` is the whole
 * frame — touch it at all and you are involved — and `inner` is the floor
 * a card has to fit inside to count as being in the room.
 */
export interface PlacementRegion {
  outer: PlacementRect;
  inner: PlacementRect;
}

/** Is `inner` wholly within `outer`? */
export function rectContains(outer: PlacementRect, inner: PlacementRect): boolean {
  return (
    inner.x >= outer.x - 1e-6 &&
    inner.y >= outer.y - 1e-6 &&
    inner.x + inner.width <= outer.x + outer.width + 1e-6 &&
    inner.y + inner.height <= outer.y + outer.height + 1e-6
  );
}

/** Do two rects share any area? Touching edges is not overlapping. */
export function rectsOverlap(a: PlacementRect, b: PlacementRect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/**
 * How far the magnet is allowed to reach, in cells. A drop into a crowded
 * corner walks outward ring by ring; past this it gives up and leaves the
 * rect where it was asked to go, because a card teleporting halfway across
 * the plan is worse than a card overlapping one.
 */
const SEARCH_LIMIT_CELLS = 40;

/**
 * A fence the search must stay inside. Any side may be left open, which is
 * how a card that cannot fit in its board's current bounds is allowed to
 * spill out of the bottom or the right — the frame grows after the drop to
 * take it back in, and growing is only possible in those two directions.
 */
export interface PlacementBounds {
  minX?: number;
  minY?: number;
  maxX?: number;
  maxY?: number;
}

/** Is this position free, and inside the fence? */
export function spotIsFree(
  rect: PlacementRect,
  blockers: PlacementRect[],
  gap = 0,
  bounds?: PlacementBounds,
  regions?: PlacementRegion[],
): boolean {
  if (bounds) {
    if (bounds.minX !== undefined && rect.x < bounds.minX - 1e-6) return false;
    if (bounds.minY !== undefined && rect.y < bounds.minY - 1e-6) return false;
    if (bounds.maxX !== undefined && rect.x + rect.width > bounds.maxX + 1e-6) return false;
    if (bounds.maxY !== undefined && rect.y + rect.height > bounds.maxY + 1e-6) return false;
  }
  if (regions) {
    for (const region of regions) {
      // Either clear of the room altogether, or all the way inside it.
      if (rectsOverlap(rect, region.outer) && !rectContains(region.inner, rect)) {
        return false;
      }
    }
  }
  return !blockers.some((blocker) => rectsOverlap(rect, blocker, gap));
}

/**
 * The nearest grid position where `rect` touches nothing in `blockers` and
 * stays inside `bounds`.
 *
 * Returns the rect's own position when it already fits, so a drop that
 * needs no help is left exactly where the hand put it. The search walks
 * outward in square rings and takes the closest free cell, ties broken
 * top-left-first so the same drop always lands the same way.
 */
export function nearestFreeSpot(
  rect: PlacementRect,
  blockers: PlacementRect[],
  gap = 0,
  bounds?: PlacementBounds,
  regions?: PlacementRegion[],
): { x: number; y: number } {
  const collides = (x: number, y: number) =>
    !spotIsFree({ x, y, width: rect.width, height: rect.height }, blockers, gap, bounds, regions);

  if (!collides(rect.x, rect.y)) {
    return { x: rect.x, y: rect.y };
  }

  // Only blockers within reach can matter; on a big plan this is the
  // difference between scanning a neighbourhood and scanning the board.
  const reach = SEARCH_LIMIT_CELLS * BOARD_GRID;
  const near = blockers.filter((blocker) =>
    rectsOverlap(
      {
        x: rect.x - reach,
        y: rect.y - reach,
        width: rect.width + reach * 2,
        height: rect.height + reach * 2,
      },
      blocker,
    ),
  );
  const collidesNear = (x: number, y: number) =>
    !spotIsFree({ x, y, width: rect.width, height: rect.height }, near, gap, bounds, regions);

  for (let radius = 1; radius <= SEARCH_LIMIT_CELLS; radius += 1) {
    const offsets: Array<{ dx: number; dy: number }> = [];
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === radius) {
          offsets.push({ dx, dy });
        }
      }
    }
    // Closest first; ties go to the top-left so the magnet is predictable.
    offsets.sort(
      (left, right) =>
        left.dx * left.dx + left.dy * left.dy - (right.dx * right.dx + right.dy * right.dy) ||
        left.dy - right.dy ||
        left.dx - right.dx,
    );
    for (const { dx, dy } of offsets) {
      const x = rect.x + dx * BOARD_GRID;
      const y = rect.y + dy * BOARD_GRID;
      if (!collidesNear(x, y)) {
        return { x, y };
      }
    }
  }

  return { x: rect.x, y: rect.y };
}
