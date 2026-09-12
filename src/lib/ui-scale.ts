/**
 * The interface size, as a setting.
 *
 * The setting's 100% renders at 117% on desktop (10% smaller than the
 * previous 130% baseline, Jack, 2026-09-10). The chrome
 * (top bar, both columns, the toolbars over the board, dialogs, menus) is
 * scaled with CSS `zoom` on the app shell (`.ui-scale-shell` in globals.css),
 * and the board is scaled through its own camera instead: React Flow measures
 * cards and the pointer in two different pixel spaces once CSS zoom is
 * involved (fit framed a plan at a third of its size, wheel zoom drifted,
 * drags ran fast - probed 2026-09-07), so `.react-flow` UNZOOMS itself back
 * to real pixels and the board's zoom ceilings and glance thresholds carry
 * the factor instead (`boardZoomScale` below; board-camera.ts, node-detail.ts).
 *
 * Two pixel spaces exist from here on, and every measurement has to say
 * which one it is in:
 * - REAL pixels: `clientX`, `getBoundingClientRect`, `window.innerWidth`,
 *   anything inside `.react-flow`, and anything portaled to `document.body`
 *   (a portal root is outside the shell, so it is unzoomed).
 * - SHELL pixels: layout inside the zoomed shell - `offsetWidth`, `clientWidth`,
 *   `style.left`, `scrollLeft`, ResizeObserver rects, CSS lengths, and `vh`
 *   (viewport units are NOT divided by zoom, so `100vh` inside the shell
 *   renders taller than the window; use the `--ui-vh` / `--ui-vw` /
 *   `--ui-dvh` lengths from globals.css).
 * A rect read in real pixels and written into a shell-pixel style is off by
 * the factor: divide by `getUiScale()` on the way across. A portal to the
 * body keeps its positioning box unzoomed (real pixels both ways) and wears
 * `.ui-zoom` on its visual box so its contents are drawn at the setting.
 *
 * Phones use a 0.9 base on a viewport that is compact at 1:1,
 * because the drawers are 344px wide and a 390px phone has no room for a
 * third more. The base is read once per page load.
 *
 * The no-flash boot script in layout.tsx stamps the same variables before
 * first paint from the same storage key (`uiScaleBootScript` in
 * ui-scale-boot.ts, which has no hook import so the server layout may use it), and
 * `UiScaleRestore` re-stamps them once the app runs and after a
 * back-forward-cache restore, exactly as the font does.
 */

import { useSyncExternalStore } from "react";
import {
  DEFAULT_UI_SCALE_PERCENT,
  PHONE_MEDIA_QUERY,
  UI_SCALE_PHONE_BASE,
  UI_SCALE_BASE,
  UI_SCALE_INVERSE_VAR,
  UI_SCALE_MAX_PERCENT,
  UI_SCALE_MIN_PERCENT,
  UI_SCALE_STEP_PERCENT,
  UI_SCALE_STORAGE_KEY,
  UI_SCALE_VAR,
} from "@/lib/ui-scale-boot";

export {
  DEFAULT_UI_SCALE_PERCENT,
  UI_SCALE_BASE,
  UI_SCALE_INVERSE_VAR,
  UI_SCALE_MAX_PERCENT,
  UI_SCALE_MIN_PERCENT,
  UI_SCALE_STEP_PERCENT,
  UI_SCALE_STORAGE_KEY,
  UI_SCALE_VAR,
};

export function clampUiScalePercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return DEFAULT_UI_SCALE_PERCENT;
  }
  const stepped = Math.round(percent / UI_SCALE_STEP_PERCENT) * UI_SCALE_STEP_PERCENT;
  return Math.min(UI_SCALE_MAX_PERCENT, Math.max(UI_SCALE_MIN_PERCENT, stepped));
}

export function getStoredUiScalePercent(): number {
  if (typeof window === "undefined") {
    return DEFAULT_UI_SCALE_PERCENT;
  }
  try {
    const raw = window.localStorage.getItem(UI_SCALE_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_UI_SCALE_PERCENT;
    }
    return clampUiScalePercent(Number(raw));
  } catch {
    return DEFAULT_UI_SCALE_PERCENT;
  }
}

let baseCache: number | undefined;

/**
 * 1.17 on a desktop-sized window, 0.9 on a phone. Read once per page load.
 * Also 1 where there is no matchMedia to ask (the server, jsdom tests): the
 * boot script is what zooms the shell, and it did not run there either.
 */
export function getUiScaleBase(): number {
  if (baseCache !== undefined) {
    return baseCache;
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return 1;
  }
  baseCache = window.matchMedia(PHONE_MEDIA_QUERY).matches ? UI_SCALE_PHONE_BASE : UI_SCALE_BASE;
  return baseCache;
}

/** The CSS zoom factor a percent renders at. */
export function uiScaleFactor(percent: number, base = getUiScaleBase()): number {
  return Math.round((clampUiScalePercent(percent) / 100) * base * 1000) / 1000;
}

let currentPercent: number | undefined;
const listeners = new Set<() => void>();

function readPercent(): number {
  currentPercent ??= getStoredUiScalePercent();
  return currentPercent;
}

/** The interface size as a percent of the default, for the settings sheet. */
export function getUiScalePercent(): number {
  return readPercent();
}

/**
 * The live CSS zoom factor of the shell. 1 on the server and in tests, where
 * nothing is zoomed and every measurement is already in real pixels.
 */
export function getUiScale(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  return uiScaleFactor(readPercent());
}

/**
 * The board's share of the interface size. The board cannot be CSS-zoomed
 * (see the header), so its camera carries the factor instead: framing stops
 * at `boardCameraMaxZoom`, the wheel at `boardMaxZoom`, and the glance step
 * moves with it (node-detail.ts), so a card at any React Flow zoom looks the
 * way it did under browser zoom at the same number.
 */
export function boardZoomScale(): number {
  return getUiScale();
}

export function applyUiScaleToDocument(factor: number): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty(UI_SCALE_VAR, String(factor));
  // The exact reciprocal as a calc(), never a rounded decimal: the board
  // cancels the shell's zoom with it, and anything short of exactly 1 puts
  // every card on sub-pixel geometry that doubles the compositor's work on
  // every pan frame (globals.css, --ui-scale-inverse).
  root.style.setProperty(UI_SCALE_INVERSE_VAR, `calc(1 / ${factor})`);
}

export function setUiScalePercent(percent: number): void {
  const next = clampUiScalePercent(percent);
  currentPercent = next;
  try {
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(next));
  } catch {
    // Private mode or a full disk: the choice lasts for the page.
  }
  applyUiScaleToDocument(uiScaleFactor(next));
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Re-stamps the stored scale. The boot script normally has, but a
 * back-forward-cache restore runs no script (see AppFontRestore).
 */
export function restoreUiScale(): void {
  applyUiScaleToDocument(getUiScale());
}

export function subscribeUiScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerScale(): number {
  return 1;
}

/** The live shell zoom factor, re-rendering when the setting changes. */
export function useUiScale(): number {
  return useSyncExternalStore(subscribeUiScale, getUiScale, getServerScale);
}

function getServerPercent(): number {
  return DEFAULT_UI_SCALE_PERCENT;
}

export function useUiScalePercent(): number {
  return useSyncExternalStore(subscribeUiScale, getUiScalePercent, getServerPercent);
}
