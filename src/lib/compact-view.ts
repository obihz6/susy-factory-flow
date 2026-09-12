"use client";

import { useSyncExternalStore } from "react";
import { getUiScale, subscribeUiScale } from "@/lib/ui-scale";
import { COMPACT_MAX_HEIGHT, COMPACT_MAX_WIDTH, SNUG_MAX_WIDTH } from "@/lib/viewport-breakpoints";

/**
 * Compact mode: one column instead of three.
 *
 * Below this width the board cannot share the window with both side columns —
 * 344 + 332 leaves a phone nothing — so in compact mode the columns become
 * drawers that slide over the board, the top bar folds into one menu, and each
 * board toolbar folds into one button.
 *
 * `globals.css` defines a Tailwind `compact:` variant for the style-only half
 * of the switch (heights, min-heights, font sizes). It keys on the
 * `data-compact` attribute this module stamps on <html>, so the two can never
 * disagree; the boot script in layout.tsx stamps it before first paint.
 *
 * The numbers are SHELL pixels: the interface size (ui-scale.ts) zooms the
 * whole shell, so a 1400px window at 130% has 1077px of layout in it, and the
 * media queries are built from the live factor.
 */
export { COMPACT_MAX_WIDTH, COMPACT_MAX_HEIGHT, SNUG_MAX_WIDTH };

/*
 * COMPACT_MAX_HEIGHT: a short window is compact too, whatever its width. A
 * phone held sideways is 932x430 on the newest iPhones — wide enough to clear
 * the width test and nowhere near tall enough for a 720px-tall app. It used to
 * get the desktop layout, whose minimum heights then pushed the board's bottom
 * corners off the screen.
 *
 * SNUG_MAX_WIDTH: wide enough for the full top bar, not wide enough for every
 * button to keep its word. Between the compact cutoff and here the bar's
 * labelled buttons drop to their icons; the bar used to overflow, and an
 * overflowing bar is what makes a phone browser widen its layout viewport and
 * shrink the whole page to fit (see AppMenu).
 */

/**
 * `max-width` rather than the `(width < 900px)` range form: the range syntax
 * needs a 2022-or-later browser, and this decides the whole layout. The 0.02
 * keeps a fractional window width (899.5px, which happens on scaled displays)
 * from landing between this query and its `min-width` complement.
 *
 * The comma is an OR: either measurement being short is enough.
 */
export function compactMediaQuery(scale: number): string {
  return `(max-width: ${COMPACT_MAX_WIDTH * scale - 0.02}px), (max-height: ${
    COMPACT_MAX_HEIGHT * scale - 0.02
  }px)`;
}

export function snugMediaQuery(scale: number): string {
  return `(max-width: ${SNUG_MAX_WIDTH * scale - 0.02}px)`;
}

interface ViewportQueries {
  scale: number;
  compact: MediaQueryList;
  snug: MediaQueryList;
}

let queries: ViewportQueries | undefined;
const listeners = new Set<() => void>();

function getQueries(): ViewportQueries | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  const scale = getUiScale();
  if (queries && queries.scale === scale) {
    return queries;
  }
  if (queries) {
    queries.compact.removeEventListener("change", notify);
    queries.snug.removeEventListener("change", notify);
  }
  queries = {
    scale,
    compact: window.matchMedia(compactMediaQuery(scale)),
    snug: window.matchMedia(snugMediaQuery(scale)),
  };
  if (listeners.size > 0) {
    queries.compact.addEventListener("change", notify);
    queries.snug.addEventListener("change", notify);
  }
  return queries;
}

function notify(): void {
  stampViewportAttributes();
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Whether the window is compact right now, for callers outside React.
 *
 * A media query, not `window.innerWidth`: a mobile browser widens the layout
 * viewport when content overflows it, so `innerWidth` on a 390px phone can
 * report 935 and answer this question backwards. Media queries are evaluated
 * against the initial containing block, which is the number that matters.
 */
export function isCompactViewport(): boolean {
  return getQueries()?.compact.matches ?? false;
}

export function isSnugViewport(): boolean {
  return getQueries()?.snug.matches ?? false;
}

/**
 * Writes the two answers onto <html> for the CSS variants. Idempotent; called
 * on every change of window or scale, and once by UiScaleRestore on mount.
 */
export function stampViewportAttributes(): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const compact = isCompactViewport();
  const snug = isSnugViewport();
  if (compact !== root.hasAttribute("data-compact")) {
    if (compact) {
      root.setAttribute("data-compact", "");
    } else {
      root.removeAttribute("data-compact");
    }
  }
  if (snug !== root.hasAttribute("data-snug")) {
    if (snug) {
      root.setAttribute("data-snug", "");
    } else {
      root.removeAttribute("data-snug");
    }
  }
}

let scaleUnsubscribe: (() => void) | undefined;

function subscribe(onChange: () => void): () => void {
  const current = getQueries();
  if (!current) {
    return () => {};
  }
  if (listeners.size === 0) {
    current.compact.addEventListener("change", notify);
    current.snug.addEventListener("change", notify);
    // A new scale means new queries: rebuild them and re-answer.
    scaleUnsubscribe = subscribeUiScale(() => {
      getQueries();
      notify();
    });
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      queries?.compact.removeEventListener("change", notify);
      queries?.snug.removeEventListener("change", notify);
      scaleUnsubscribe?.();
      scaleUnsubscribe = undefined;
    }
  };
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Re-renders when the window crosses the compact threshold.
 *
 * The server has no width to measure, so it renders the full three-column
 * layout and the client corrects on the first paint — the same deal the
 * workspace and board view settings make.
 */
export function useIsCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, isCompactViewport, getServerSnapshot);
}

/** Re-renders when labels need to give way to icons on narrower windows. */
export function useIsSnugViewport(): boolean {
  return useSyncExternalStore(subscribe, isSnugViewport, getServerSnapshot);
}

/** Keeps the <html> viewport attributes live for as long as it is mounted. */
export function subscribeViewportAttributes(): () => void {
  stampViewportAttributes();
  return subscribe(() => {});
}
