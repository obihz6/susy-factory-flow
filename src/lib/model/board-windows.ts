import type { FactoryAnnotation, FactoryNode, FactoryPocket, FactoryStorage } from "./types";
import { BOARD_WINDOW_DEFAULT_SIZE, BOARD_WINDOW_TITLE_HEIGHT } from "@/lib/board-grid";

/**
 * The board-window view of the pocket tree.
 *
 * Every `FactoryPocket` IS a board: open (`expanded`) it is a window frame
 * whose members render inside it; collapsed it is the same window shaded down
 * to its title bar, members hidden behind the bar. There is no other pocket
 * representation and no separate "dive-in" level — the canvas always shows
 * the root, plus the contents of every board whose whole chain of ancestors
 * is open. Everything here is pure derivation from the project; the only
 * stored state is the `expanded` flag and the frame size.
 *
 * Coordinate spaces: an item's stored position is relative to its OWNER's
 * frame origin (the window's top-left corner), and a root item is in plain
 * flow space. That is exactly React Flow's parent/child contract, which is
 * what lets a dragged frame carry its members.
 */

/** The slice of a project the view derives from. */
export interface BoardLevelInput {
  nodes: FactoryNode[];
  storages?: FactoryStorage[];
  annotations?: FactoryAnnotation[];
  pockets?: FactoryPocket[];
}

export interface BoardLevelView {
  /**
   * Whether a board's CONTENTS are in view: the root always is, and a board
   * shows its members when it and every ancestor above it stand open.
   */
  isLevelShown: (levelId: string | undefined) => boolean;
  /**
   * What stands for an item in this view: the item itself when its owner
   * chain is open, otherwise the outermost collapsed board bar hiding it.
   * Undefined only for dangling owners (repaired on load).
   */
  representativeOf: (itemId: string) => string | undefined;
  /** Boards drawn as collapsed title bars in this view. */
  collapsedBoards: FactoryPocket[];
  /** Boards standing open as window frames, parents always before children. */
  openBoards: FactoryPocket[];
}

export function computeBoardLevelView(input: BoardLevelInput): BoardLevelView {
  const pockets = input.pockets ?? [];
  const pocketById = new Map(pockets.map((pocket) => [pocket.id, pocket]));

  const shownMemo = new Map<string, boolean>();
  const isLevelShown = (levelId: string | undefined): boolean => {
    if (levelId === undefined) {
      return true;
    }
    const cached = shownMemo.get(levelId);
    if (cached !== undefined) {
      return cached;
    }
    // Seed false first: a cyclic parent chain (repaired on load, but never
    // trusted here) terminates instead of recursing forever.
    shownMemo.set(levelId, false);
    const pocket = pocketById.get(levelId);
    const shown = Boolean(pocket?.expanded && isLevelShown(pocket.parentPocketId));
    shownMemo.set(levelId, shown);
    return shown;
  };

  const ownerById = new Map<string, string | undefined>();
  for (const node of input.nodes) {
    ownerById.set(node.id, node.pocketId);
  }
  for (const storage of input.storages ?? []) {
    ownerById.set(storage.id, storage.pocketId);
  }
  for (const annotation of input.annotations ?? []) {
    ownerById.set(annotation.id, annotation.pocketId);
  }

  const representativeOf = (itemId: string): string | undefined => {
    let level = ownerById.get(itemId);
    if (isLevelShown(level)) {
      return itemId;
    }
    // Climb to the outermost collapsed board whose own bar is in view.
    const seen = new Set<string>();
    while (level !== undefined && !seen.has(level)) {
      seen.add(level);
      const pocket = pocketById.get(level);
      if (!pocket) {
        return undefined;
      }
      if (isLevelShown(pocket.parentPocketId)) {
        // This ancestor's bar is in view; were it open its level would have
        // been shown above, so it is the collapsed bar hiding the item.
        return pocket.id;
      }
      level = pocket.parentPocketId;
    }
    return undefined;
  };

  const collapsedBoards = pockets.filter(
    (pocket) => !isLevelShown(pocket.id) && isLevelShown(pocket.parentPocketId),
  );
  // Parents before children — React Flow requires a parent node to appear
  // before every node that names it in `parentId`.
  const openBoards = pockets
    .filter((pocket) => isLevelShown(pocket.id))
    .sort((left, right) => boardDepth(pocketById, left) - boardDepth(pocketById, right));

  return { isLevelShown, representativeOf, collapsedBoards, openBoards };
}

function boardDepth(pocketById: Map<string, FactoryPocket>, pocket: FactoryPocket): number {
  let depth = 0;
  let parentId = pocket.parentPocketId;
  const seen = new Set<string>([pocket.id]);
  while (parentId !== undefined && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = pocketById.get(parentId)?.parentPocketId;
  }
  return depth;
}

/** An open board's frame in flow space. */
export interface OpenBoardRect {
  id: string;
  /** Nesting depth; deeper wins a containment tie. */
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boardWindowSize(pocket: FactoryPocket): { width: number; height: number } {
  return pocket.size ?? BOARD_WINDOW_DEFAULT_SIZE;
}

/**
 * Absolute frames for every open board in view. Frame positions are stored
 * relative to their parent frame, so the rects accumulate down the tree —
 * `openBoards` already comes parents-first from `computeBoardLevelView`.
 */
export function computeOpenBoardRects(openBoards: FactoryPocket[]): OpenBoardRect[] {
  const rects = new Map<string, OpenBoardRect>();
  for (const board of openBoards) {
    const parent =
      board.parentPocketId !== undefined ? rects.get(board.parentPocketId) : undefined;
    const size = boardWindowSize(board);
    rects.set(board.id, {
      id: board.id,
      depth: (parent?.depth ?? 0) + 1,
      x: (parent?.x ?? 0) + board.position.x,
      y: (parent?.y ?? 0) + board.position.y,
      width: size.width,
      height: size.height,
    });
  }
  return [...rects.values()];
}

/** The floor of an open board: everything under its title bar. */
export function boardBodyRect(rect: OpenBoardRect): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: rect.x,
    y: rect.y + BOARD_WINDOW_TITLE_HEIGHT,
    width: rect.width,
    height: rect.height - BOARD_WINDOW_TITLE_HEIGHT,
  };
}

/**
 * Which open board a dropped CARD lands in: the deepest frame whose floor
 * holds the whole card. Wholly, not mostly — a card lying across a wall
 * belongs to neither side, and the placement magnet has already refused to
 * leave one there. Excluded boards are skipped (a dragged board and its
 * descendants: nothing may become its own ancestor). Undefined = the card
 * came to rest on the canvas, out of every room.
 */
export function pickBoardOwnerFor(
  rects: OpenBoardRect[],
  card: { x: number; y: number; width: number; height: number },
  excludedIds?: ReadonlySet<string>,
): string | undefined {
  let winner: OpenBoardRect | undefined;
  for (const rect of rects) {
    if (excludedIds?.has(rect.id)) {
      continue;
    }
    const body = boardBodyRect(rect);
    const inside =
      card.x >= body.x - 1e-6 &&
      card.y >= body.y - 1e-6 &&
      card.x + card.width <= body.x + body.width + 1e-6 &&
      card.y + card.height <= body.y + body.height + 1e-6;
    if (inside && (!winner || rect.depth > winner.depth)) {
      winner = rect;
    }
  }
  return winner?.id;
}

/** Every board nested anywhere under `rootId`, transitively. */
export function collectPocketDescendantIds(pockets: FactoryPocket[], rootId: string): Set<string> {
  const childrenByParent = new Map<string | undefined, FactoryPocket[]>();
  for (const pocket of pockets) {
    const siblings = childrenByParent.get(pocket.parentPocketId);
    if (siblings) {
      siblings.push(pocket);
    } else {
      childrenByParent.set(pocket.parentPocketId, [pocket]);
    }
  }
  const descendants = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.pop()!;
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return descendants;
}
