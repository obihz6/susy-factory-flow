/**
 * The planner's font, as a setting.
 *
 * Everything renders in Monocraft by default. This module owns the choice of
 * something else: the option list the settings dialog shows, the localStorage
 * key it persists to, and the `data-app-font` attribute on <html> that
 * globals.css keys its `--app-font` overrides on.
 *
 * Two places must stay in step with `APP_FONTS`:
 * - the `html[data-app-font="..."]` rules in globals.css (each option's
 *   `stack` here is the same string, used inline for the picker's previews),
 * - the next/font loaders in layout.tsx that define the `--font-*` variables
 *   the stacks read.
 *
 * The no-flash boot script in layout.tsx reads the same storage key before
 * first paint; it deliberately does not validate the id, because an unknown
 * value matches no CSS rule and falls through to the Monocraft default.
 */

export type AppFontId =
  | "minecraft"
  | "inter"
  | "lexend"
  | "atkinson-hyperlegible"
  | "open-dyslexic"
  | "andika"
  | "comic-neue"
  | "jetbrains-mono"
  | "system";

export interface AppFontOption {
  id: AppFontId;
  label: string;
  /** One plain line under the name in the picker. */
  blurb: string;
  /** The CSS font-family stack, identical to the globals.css rule for the id. */
  stack: string;
}

export const APP_FONTS: readonly AppFontOption[] = [
  {
    id: "minecraft",
    label: "Minecraft",
    blurb: "The pixel font the planner ships with.",
    stack: "var(--font-minecraft), monospace",
  },
  {
    id: "inter",
    label: "Inter",
    blurb: "A plain modern typeface.",
    stack: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "lexend",
    label: "Lexend",
    blurb: "Designed for easier reading.",
    stack: "var(--font-lexend), ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "atkinson-hyperlegible",
    label: "Atkinson Hyperlegible",
    blurb: "Designed for low vision readers.",
    stack: "var(--font-atkinson), ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "open-dyslexic",
    label: "OpenDyslexic",
    blurb: "Weighted letters made for dyslexic readers.",
    stack: "var(--font-open-dyslexic), ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "andika",
    label: "Andika",
    blurb: "Clear letters made hard to confuse with each other.",
    stack: "var(--font-andika), ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "comic-neue",
    label: "Comic Neue",
    blurb: "Casual and rounded. Easy on some dyslexic readers too.",
    stack: "var(--font-comic-neue), ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    blurb: "A monospace typeface made for reading numbers.",
    stack: "var(--font-jetbrains-mono), ui-monospace, monospace",
  },
  {
    id: "system",
    label: "System",
    blurb: "Whatever your device already uses.",
    stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
];

export const DEFAULT_APP_FONT: AppFontId = "minecraft";

/** Shared with the inline boot script in layout.tsx. */
export const APP_FONT_STORAGE_KEY = "gtnh-app-font";

export function isAppFontId(value: unknown): value is AppFontId {
  return APP_FONTS.some((option) => option.id === value);
}

export function getStoredAppFont(): AppFontId {
  if (typeof window === "undefined") {
    return DEFAULT_APP_FONT;
  }
  try {
    const stored = window.localStorage.getItem(APP_FONT_STORAGE_KEY);
    return isAppFontId(stored) ? stored : DEFAULT_APP_FONT;
  } catch {
    return DEFAULT_APP_FONT;
  }
}

/**
 * Applies the font to the page and remembers it. The default carries no
 * attribute and no storage entry, so a fresh profile and a reset one are the
 * same state.
 */
export function setAppFont(id: AppFontId): void {
  if (typeof window === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (id === DEFAULT_APP_FONT) {
    root.removeAttribute("data-app-font");
  } else {
    root.setAttribute("data-app-font", id);
  }
  try {
    if (id === DEFAULT_APP_FONT) {
      window.localStorage.removeItem(APP_FONT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(APP_FONT_STORAGE_KEY, id);
    }
  } catch {
    // Storage refused (private mode, quota): the page still changes, it just
    // will not survive a reload.
  }
}
