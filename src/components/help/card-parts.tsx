"use client";

import { Fragment, useId } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The glance card the board's "?" corner is built from.
 *
 * The idea: dim the screen, ring a thing, put a card beside it saying what it
 * is. A row leads with the mark the SCREEN uses: the button's own icon, a key
 * chip, or a little mouse with the right button lit, and the words that matter
 * are lit rather than spelled out at length. That is what stops the surface
 * reading as a wall of text.
 *
 * The help sheet lays eight cards over the whole window at once, where eight
 * cyan cards would be a fairground, so it passes a calmer accent in and keeps
 * cyan (GLANCE_ACCENT) for anything that can be clicked. A future guided
 * walkthrough can reuse the same card.
 */

export type GlanceTone =
  | "need"
  | "product"
  | "output"
  | "internal"
  | "fine"
  | "starved"
  | "blocked"
  | "bottleneck"
  | "clogged"
  | "build"
  | "solve"
  | "pool";

/** Which mouse button a row is about, drawn as a little lit-up mouse. */
export type GlanceMouse = "left" | "right" | "scroll";

export interface GlanceRow {
  /** The button's own icon, so the row and the board wear the same mark. */
  icon?: LucideIcon;
  /** A short chip in front: a shortcut, a unit, a symbol off the screen. */
  chip?: string;
  /** Draws a mouse with that button lit. */
  mouse?: GlanceMouse;
  /** Draws a drawer's silhouette in its board tint. */
  shape?: GlanceDrawerShape;
  /** Colours the chip. Only worth it where the app is colour-coded too. */
  tone?: GlanceTone;
  /** `*Words between asterisks*` come out lit. */
  text: string;
}

export type GlanceDrawerShape = "source" | "product" | "byproduct" | "trash" | "buffer";

/** The drawer tints from StorageNode's ROLE_TINTS, so the legend and the
 * board agree on what red, green and steel mean. */
const DRAWER_SHAPE_TINTS: Record<GlanceDrawerShape, string> = {
  source: "var(--flow-input)",
  product: "var(--flow-output)",
  byproduct: "var(--flow-output)",
  trash: "#8a93a6",
  buffer: "#8a93a6",
};

/**
 * A drawer's silhouette at chip size, the same cuts globals.css makes on
 * the 100x80 tile: product the plain crate, source the rounded one,
 * byproduct the shield (square shoulders, tapered base), trash the bin
 * (sides tapering to a narrower foot), buffer the hexagon.
 */
export function DrawerShapeGlyph({ shape }: { shape: GlanceDrawerShape }) {
  const tint = DRAWER_SHAPE_TINTS[shape];
  const common = { fill: `color-mix(in srgb, ${tint} 24%, transparent)`, stroke: tint, strokeWidth: 1.5, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 18" className="h-4 w-[21px] shrink-0" aria-hidden>
      {shape === "source" ? (
        <rect x="1" y="1" width="22" height="16" rx="4" {...common} />
      ) : shape === "product" ? (
        <rect x="1" y="1" width="22" height="16" {...common} />
      ) : shape === "byproduct" ? (
        <polygon points="1,1 23,1 23,12 18,17 6,17 1,12" {...common} />
      ) : shape === "trash" ? (
        <polygon points="1,1 23,1 19,17 5,17" {...common} />
      ) : (
        <polygon points="5,1 19,1 23,9 19,17 5,17 1,9" {...common} />
      )}
    </svg>
  );
}

export const GLANCE_ACCENT = "#22d3ee";
/** The calm accent, for a sheet that draws many cards at once. */
export const GLANCE_QUIET = "#93a4bb";
export const GLANCE_LINE = "#2a3441";

/**
 * Chip colours, taken from the app rather than invented.
 *
 * The machine states are the board's own verdict inks (globals.css), so a
 * chip is the same colour as the word on the card it describes. None of them is
 * green: on this board green says "fine", and most of these are not.
 */
export const GLANCE_TONES: Record<GlanceTone, string> = {
  need: "#f87171",
  // The product-drawer blue, since the drawer tiles became colour-coded.
  product: "#60a5fa",
  output: "#4ade80",
  internal: "#9a9ca4",
  fine: "#9a9ca4",
  starved: "#b3ae76",
  blocked: "#e0a63a",
  bottleneck: "#e05252",
  // The clog family's cool blue (--verdict-clogged-ink): full, not broken.
  clogged: "#6fb2d6",
  // The three mode keys' own inks (ModeKeys in FactoryFlow.tsx).
  build: "#f5b642",
  solve: "#c78bff",
  pool: "#6f9cff",
};

export const GLANCE_CARD_CLASS =
  "bg-[#151a21] text-[#dbe3ec] shadow-[8px_8px_0_rgba(0,0,0,0.55)]";

/** Split a row's text on its asterisks. Odd pieces are the lit ones. */
export function splitEmphasis(text: string): string[] {
  return text.split("*");
}

/**
 * A little mouse with one button lit.
 *
 * "Left click" and "right click" are what a board gesture usually comes down
 * to, and a drawing of the button says it faster than the words do. The lit
 * half is a plain rectangle CLIPPED to the mouse's own rounded body, so it
 * takes the shell's corners exactly without anyone hand-fitting a curve.
 */
export function MouseGlyph({ kind, color }: { kind: GlanceMouse; color: string }) {
  const clipId = useId();
  return (
    <svg viewBox="0 0 14 18" className="h-4 w-4 shrink-0" aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <rect x="1.5" y="1" width="11" height="16" rx="5.5" />
        </clipPath>
      </defs>
      {kind === "left" || kind === "right" ? (
        <rect
          clipPath={`url(#${clipId})`}
          x={kind === "left" ? 1.5 : 7}
          y="1"
          width="5.5"
          height="6"
          fill={color}
        />
      ) : (
        <rect x="6" y="2.6" width="2" height="4.2" rx="1" fill={color} />
      )}
      <rect
        x="1.5"
        y="1"
        width="11"
        height="16"
        rx="5.5"
        fill="none"
        stroke={color}
        strokeWidth="1.3"
      />
      <path d="M1.5 7 H12.5 M7 1 V7" stroke={color} strokeWidth="1.1" fill="none" />
    </svg>
  );
}

/**
 * A step or callout's lines.
 *
 * A grid rather than a stack of flex rows, with each row `display: contents`:
 * the mark column then sizes itself to the widest mark in the card - the
 * difference between a chip reading BOTTLENECK and one reading TTLENECK - and
 * every row's words still start on the same line down the card.
 */
export function GlanceRows({
  rows,
  accent = GLANCE_ACCENT,
  dense = false,
}: {
  rows: readonly GlanceRow[];
  accent?: string;
  /** Smaller type, for a sheet showing many cards at once. */
  dense?: boolean;
}) {
  return (
    <ul
      className={[
        "grid grid-cols-[auto_1fr] items-start",
        dense ? "gap-x-2 gap-y-1" : "gap-x-2.5 gap-y-2",
      ].join(" ")}
    >
      {rows.map((row) => (
        <GlanceRowLine key={row.text} row={row} accent={accent} dense={dense} />
      ))}
    </ul>
  );
}

function GlanceRowLine({
  row,
  accent,
  dense,
}: {
  row: GlanceRow;
  accent: string;
  dense: boolean;
}) {
  const Icon = row.icon;
  const chipColor = row.tone ? GLANCE_TONES[row.tone] : accent;

  return (
    <li className="contents">
      <span
        className={["flex items-center justify-end", dense ? "h-4" : "h-[19px]"].join(" ")}
      >
        {row.mouse ? (
          <MouseGlyph kind={row.mouse} color={accent} />
        ) : row.shape ? (
          <DrawerShapeGlyph shape={row.shape} />
        ) : Icon ? (
          <Icon className={dense ? "h-3.5 w-3.5" : "h-4 w-4"} style={{ color: accent }} />
        ) : row.chip ? (
          <span
            className="whitespace-nowrap border px-1 py-px text-[10px] font-black leading-[13px]"
            style={{ borderColor: chipColor, color: chipColor, backgroundColor: `${chipColor}1f` }}
          >
            {row.chip}
          </span>
        ) : (
          <span className="text-[11px] leading-none" style={{ color: "#4a5a6b" }}>
            ▸
          </span>
        )}
      </span>
      <span
        className={[
          "text-[#c3cedb]",
          dense ? "text-[11px] leading-[1.35]" : "text-[13px] leading-[1.45]",
        ].join(" ")}
      >
        {splitEmphasis(row.text).map((piece, index) =>
          index % 2 === 1 ? (
            <strong key={index} className="font-bold" style={{ color: "#e8f6fb" }}>
              {piece}
            </strong>
          ) : (
            <Fragment key={index}>{piece}</Fragment>
          ),
        )}
      </span>
    </li>
  );
}

/** A card's headline: the one big white sentence at the top of it. */
export function GlanceTitle({ children, dense = false }: { children: string; dense?: boolean }) {
  return (
    <p
      className={[
        "font-bold leading-tight text-white",
        dense ? "text-[13px]" : "text-[18px]",
      ].join(" ")}
    >
      {children}
    </p>
  );
}
