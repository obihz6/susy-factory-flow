/**
 * Board background themes: the paper the factory is drawn on.
 *
 * A theme is four things: the flat base colour (also what image exports use
 * for their background), the ink the background pattern is drawn in, the
 * paper's GRAIN, and an optional vignette. Grain is drawn in BOARD SPACE
 * (GrainBackground in board-pattern.tsx): it pans and zooms with the factory
 * exactly like the dots do, because tooth belongs to the paper, not to the
 * window — a texture that stays put while the board slides underneath reads
 * as a dirty monitor. The vignette is the one screen-space layer allowed:
 * pure edge darkening with no landmarks, so nothing about it can be seen to
 * "stick" during a pan.
 */
export type CanvasThemeId =
  | "charcoal"
  | "slate"
  | "gunmetal"
  | "midnight"
  | "void"
  | "blueprint"
  | "chalkboard"
  | "graphite"
  | "parchment"
  | "paper";

/** One board-space grain layer: a tileable image, sized in board px at 1x. */
export interface CanvasGrainLayer {
  uri: string;
  /** Tile edge in board pixels at zoom 1. */
  size: number;
  /** Layer strength; 1 when omitted. */
  opacity?: number;
}

export interface CanvasTheme {
  id: CanvasThemeId;
  name: string;
  /** The flat paper colour. Exports use this as their background. */
  base: string;
  /** The ink the background pattern (dots, lines, rulings) is drawn in. */
  patternColor: string;
  /** Board-space grain layers, drawn by GrainBackground under the pattern. */
  grain?: CanvasGrainLayer[];
  /**
   * Optional screen-space room light for the board div: edge vignettes ONLY.
   * Anything with a landmark — a centre glow, a diagonal wipe — must not go
   * here; it visibly stays put while the board pans.
   */
  vignette?: string;
  /**
   * The same grain as CSS, for element fills (boxes, zones): those elements
   * ride the viewport themselves, so a plain CSS tile already pans with them.
   */
  texture?: string;
}

/** Intrinsic tile edge of the grain images, and their board size at zoom 1. */
export const GRAIN_TILE = 240;

/**
 * Film grain with real tooth, as raw data URIs so SVG patterns can embed them
 * (the board's grain layer, a zone's textured fill). Low base frequency plus
 * four octaves gives millimetre-scale blotches with fine speck inside them —
 * paper texture you can actually see — and the colour matrix maps noise onto
 * a contrasty alpha so part of every tile stays fully clear. White grain
 * gives tooth to dark surfaces, dark grain to light ones.
 */
export const GRAIN_LIGHT_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.45' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.11 0 0 0 -0.03'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E";

export const GRAIN_DARK_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.45' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0 0 0 -0.028'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E";

/** Broad, soft blotching: the uneven soak of old paper. */
export const MOTTLE_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='420'%3E%3Cfilter id='m'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.42 0 0 0 0 0.3 0 0 0 0 0.12 0 0 0 0.2 0'/%3E%3C/filter%3E%3Crect width='420' height='420' filter='url(%23m)'/%3E%3C/svg%3E";

const NOISE_LIGHT = `url("${GRAIN_LIGHT_URI}")`;

const NOISE_DARK = `url("${GRAIN_DARK_URI}")`;

const MOTTLE = `url("${MOTTLE_URI}")`;

const LIGHT_GRAIN: CanvasGrainLayer[] = [{ uri: GRAIN_LIGHT_URI, size: GRAIN_TILE }];

const DARK_GRAIN: CanvasGrainLayer[] = [{ uri: GRAIN_DARK_URI, size: GRAIN_TILE }];

export const CANVAS_THEMES: CanvasTheme[] = [
  {
    // The colour the site actually shipped with: before themes existed, the
    // board you saw was React Flow's own dark wrapper at #141414. A shade
    // down from Slate, well short of Void — and the default, so the planner
    // still opens looking like itself.
    id: "charcoal",
    name: "Charcoal",
    base: "#141414",
    patternColor: "#43464d",
    grain: LIGHT_GRAIN,
    texture: NOISE_LIGHT,
  },
  {
    id: "slate",
    name: "Slate",
    base: "#1b1d21",
    patternColor: "#4a4d55",
    grain: LIGHT_GRAIN,
    texture: NOISE_LIGHT,
  },
  {
    // The step between Slate and Graphite: cooler than one, dimmer than the
    // other. Asked for by name, more or less.
    id: "gunmetal",
    name: "Gunmetal",
    base: "#23262c",
    patternColor: "#5a5f6a",
    grain: LIGHT_GRAIN,
    texture: NOISE_LIGHT,
  },
  {
    id: "midnight",
    name: "Midnight",
    base: "#161a24",
    patternColor: "#485372",
    grain: LIGHT_GRAIN,
    texture: NOISE_LIGHT,
  },
  {
    // Near-black and FLAT: the centre glow it used to carry was screen-space,
    // so it sat still while the board panned and read as a smudged monitor.
    id: "void",
    name: "Void",
    base: "#0b0c0f",
    patternColor: "#303339",
    grain: [{ uri: GRAIN_LIGHT_URI, size: GRAIN_TILE, opacity: 0.55 }],
    texture: NOISE_LIGHT,
  },
  {
    id: "blueprint",
    name: "Blueprint",
    base: "#152540",
    patternColor: "#48699c",
    grain: LIGHT_GRAIN,
    // Edge darkening only; the old corner light was a landmark and it stayed
    // put during pans.
    vignette: "radial-gradient(140% 120% at 50% 50%, transparent 52%, rgba(0,8,26,0.45) 100%)",
    texture: NOISE_LIGHT,
  },
  {
    // The chalk-wipe streaks are gone: diagonal haze in screen space slid
    // against the board on every pan, which is the shimmer that got reported.
    id: "chalkboard",
    name: "Chalkboard",
    base: "#243329",
    patternColor: "#5d7465",
    grain: LIGHT_GRAIN,
    vignette: "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.28) 100%)",
    texture: NOISE_LIGHT,
  },
  {
    id: "graphite",
    name: "Graphite",
    base: "#272522",
    patternColor: "#5f5a4f",
    grain: LIGHT_GRAIN,
    vignette: "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.3) 100%)",
    texture: NOISE_LIGHT,
  },
  {
    id: "parchment",
    name: "Parchment",
    base: "#e7ddc4",
    patternColor: "#a4966e",
    // The soak blotches are paper too, so they ride the board with the grain.
    grain: [{ uri: MOTTLE_URI, size: 420 }, { uri: GRAIN_DARK_URI, size: GRAIN_TILE }],
    vignette:
      "radial-gradient(140% 120% at 50% 50%, transparent 55%, rgba(110,80,35,0.24) 100%)",
    texture: [NOISE_DARK, MOTTLE].join(", "),
  },
  {
    id: "paper",
    name: "Paper",
    base: "#f3f1e8",
    patternColor: "#b4bac8",
    grain: [{ uri: GRAIN_DARK_URI, size: GRAIN_TILE, opacity: 0.8 }],
    texture: NOISE_DARK,
  },
];

export const DEFAULT_CANVAS_THEME_ID: CanvasThemeId = "charcoal";

const themesById = new Map(CANVAS_THEMES.map((theme) => [theme.id, theme]));

export function isCanvasThemeId(value: unknown): value is CanvasThemeId {
  return typeof value === "string" && themesById.has(value as CanvasThemeId);
}

/** Always answers: an unknown id (older saved blob, newer plan) gets Charcoal. */
export function getCanvasTheme(id: string | undefined): CanvasTheme {
  return themesById.get((id ?? DEFAULT_CANVAS_THEME_ID) as CanvasThemeId) ?? CANVAS_THEMES[0];
}
