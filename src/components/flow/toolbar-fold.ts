"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * When the board's two top toolbars fold into their single-button triggers.
 *
 * Compact mode folds them for a phone, but a desktop board can be just as
 * short of room: the side columns take 676px of the window, and the two rows
 * together want 833px on top of their margins. On a 1400px window they
 * crossed, and the paint tray sat unreachable UNDER the POWER tray. So the
 * fold is decided by the BOARD's own width, not the window's, and it happens
 * one side at a time: the paint row folds first (it is the one visited
 * less, and folding it frees 400px), and the build row only when the board
 * cannot hold even that.
 *
 * The widths are the rows as measured on the live board, each side's 12px
 * margin, and a cell of daylight between them. A fold does not shrink a row
 * to one button: the build fold keeps undo/redo out (124px with the trigger),
 * and the paint fold keeps the bin, the view keys and the export keys out
 * (280px). Each threshold is what the board needs to hold the row ABOVE it
 * once the previous fold has happened.
 */
const BUILD_ROW_WIDTH = 393;
const BUILD_ROW_FOLDED_WIDTH = 124;
const PAINT_ROW_WIDTH = 440;
const PAINT_ROW_FOLDED_WIDTH = 280;
const SIDE_MARGINS = 24;
const BREATH = 24;

export const FOLD_PAINT_BELOW = BUILD_ROW_WIDTH + PAINT_ROW_WIDTH + SIDE_MARGINS + BREATH;
export const FOLD_BUILD_BELOW = BUILD_ROW_WIDTH + PAINT_ROW_FOLDED_WIDTH + SIDE_MARGINS + BREATH;
/** Under this even both folded rows cross, so the whole paint row folds. */
export const BOTH_FOLDED_WIDTH =
  BUILD_ROW_FOLDED_WIDTH + PAINT_ROW_FOLDED_WIDTH + SIDE_MARGINS + BREATH;

export interface ToolbarFold {
  build: boolean;
  paint: boolean;
  /**
   * The WHOLE paint row folds into the brush, bin and whole-board keys
   * included: the board is too narrow for even the folded rows side by side,
   * and they stay on ONE line - a second line is a blank band over the board.
   */
  paintFoldsAll: boolean;
}

/** Which toolbars fold on a board this wide. Compact folds both regardless. */
export function toolbarFoldFor(boardWidth: number, compact: boolean): ToolbarFold {
  const paintFoldsAll = boardWidth < BOTH_FOLDED_WIDTH;
  if (compact) {
    return { build: true, paint: true, paintFoldsAll };
  }
  return {
    paint: boardWidth < FOLD_PAINT_BELOW,
    build: boardWidth < FOLD_BUILD_BELOW,
    paintFoldsAll,
  };
}

/** The name the unfolded rows read their width cap from. */
export const BOARD_WIDTH_VAR = "--board-width";

/**
 * Watches the board element's width and reports the fold it calls for.
 *
 * State holds the FOLD, never the width: the board re-renders when a side
 * folds or unfolds, not on every pixel of a window resize. The width itself
 * is written straight onto the element as a CSS variable, so an unfolded row
 * can cap itself at the board rather than the viewport (with the side
 * columns open, the two are hundreds of pixels apart).
 */
export function useToolbarFold(
  boardRef: RefObject<HTMLElement | null>,
  compact: boolean,
): ToolbarFold {
  const [fold, setFold] = useState<ToolbarFold>(() => toolbarFoldFor(Infinity, compact));

  useEffect(() => {
    const element = boardRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      setFold(toolbarFoldFor(Infinity, compact));
      return;
    }
    const measure = () => {
      const width = element.clientWidth;
      element.style.setProperty(BOARD_WIDTH_VAR, `${width}px`);
      const next = toolbarFoldFor(width, compact);
      setFold((current) =>
        current.build === next.build &&
        current.paint === next.paint &&
        current.paintFoldsAll === next.paintFoldsAll
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [boardRef, compact]);

  return fold;
}
