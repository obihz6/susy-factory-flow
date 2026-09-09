"use client";

import { useEffect } from "react";
import {
  Blocks,
  Boxes,
  Gauge,
  Layers,
  LayoutGrid,
  ListChecks,
  MousePointerClick,
  Route,
  Search,
  Sparkles,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ReleaseSpotlight as Spotlight,
  SpotlightIcon,
  SpotlightTint,
} from "@/lib/release-spotlight";
import "./release-spotlight.css";

/**
 * The release notice: what changed, in one screen, once per release.
 *
 * IT IS THE APP'S OWN WINDOW, not a web modal (Jack, 2026-09-08): square
 * corners, the heavy frame over a near-black face that the recipe book wears,
 * and the app's name at the top of it in the header's own hand, so the reader
 * knows in the first inch who is talking to them.
 *
 * IT IS SUBTLE (Jack, 2026-09-08: "more subtle ... they shouldn't look
 * clickable. They should look like it's an update"). The changes are LINES,
 * ruled apart the way the side columns rule their rows: no tile, no bevel, no
 * border, no hover, no stagger. The only pressable thing on the window is the
 * close key. Two earlier versions dressed each change as a raised key and as a
 * lit slot, and both read as a menu of eight buttons waiting to be clicked.
 *
 * NO FOOTER AND NO LINK TO ANY NOTES (Jack, 2026-09-08): there are no notes
 * to link to. The player-facing changelog is gone - the dialog, the unread
 * dot, the Welcome tab's section - and the header's version chip opens
 * nothing. This window is the whole announcement, which is why the release
 * number is printed on it, hard coded per notice in release-spotlight.ts.
 *
 * See `release-spotlight.ts` for when it shows and how to write one.
 */
export function ReleaseSpotlight({
  spotlight,
  onClose,
}: {
  spotlight: Spotlight;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={[
        "spotlight-backdrop fixed inset-0 z-[125] grid place-items-center p-4",
        // The board goes soft behind it (Jack, 2026-09-08). NOT on a phone: a
        // full-viewport backdrop-filter forces everything under it into a
        // composited layer and repaints it whenever the board moves, which is
        // the heaviest paint the app can produce. Compact gets a darker sheet
        // instead, which takes the board away just as well.
        "bg-black/55 backdrop-blur-md compact:bg-black/85 compact:[backdrop-filter:none]",
      ].join(" ")}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`What's new in v${spotlight.version}`}
        className={`spotlight-sheet relative flex max-h-[calc(90*var(--ui-vh))] w-full max-w-[900px] flex-col overflow-hidden text-[var(--mc-ink)] ${WINDOW}`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* A quiet key, not a raised one: the only pressable thing here, and it
            should not be the loudest. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center text-[var(--mc-ink-muted)] hover:bg-[var(--mc-47)] hover:text-[var(--mc-ink)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-6 compact:px-4 compact:pt-4">
          {/* The app's name in the header's own hand, and the release it is
              announcing on the end of it, the way a person says it out loud. */}
          <p className="text-[20px] font-black leading-none tracking-tight text-white compact:text-[16px]">
            GTNH <span className="text-cyan-400">Planner</span>{" "}
            <span className="tabular-nums">{spotlight.release ?? spotlight.version}</span>
          </p>
          <p className="mt-2.5 text-[34px] font-black uppercase leading-none tracking-[0.02em] text-white compact:text-[22px]">
            {spotlight.title}
          </p>
          {spotlight.subtitle ? (
            <p className="mt-2.5 text-[15px] leading-snug text-[var(--mc-ink-muted)]">
              {spotlight.subtitle}
            </p>
          ) : null}

          {/* ===== the changes, as ruled lines in two columns =====
              Two columns rather than one (Jack, 2026-09-08): eight lines down
              a narrow window read as a long list; four and four read as a
              summary you take in at once. Every line carries its own top rule
              and the list closes with one, so both columns are ruled top and
              bottom whatever the count is. */}
          <ul className="mt-5 grid border-b border-[var(--mc-56)] sm:grid-cols-2 sm:gap-x-10">
            {spotlight.items.map((item) => (
              <Line key={item.title} item={item} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Line({ item }: { item: SpotlightItem }) {
  const Icon = ICONS[item.icon];
  return (
    <li className="flex items-center gap-3 border-t border-[var(--mc-56)] py-3">
      <Icon
        aria-hidden
        className="h-[21px] w-[21px] shrink-0"
        style={{ color: TINTS[item.tint ?? "cyan"] }}
      />
      {/* Uppercase and tracked, the label voice the rails and the toolbars
          use. Eight of these read as a spec sheet rather than as eight little
          sentences. */}
      <span className="min-w-0 text-[16px] font-bold uppercase leading-[1.2] tracking-[0.05em] text-[var(--mc-ink)]">
        {item.title}
      </span>
    </li>
  );
}

type SpotlightItem = Spotlight["items"][number];

/**
 * A curated set, keyed by what the change IS rather than by a lucide name, so
 * the data file stays plain text and swapping the drawing for a better one is
 * a change in one place.
 */
const ICONS: Record<SpotlightIcon, LucideIcon> = {
  modes: Layers,
  shared: Boxes,
  checklist: ListChecks,
  menu: MousePointerClick,
  arrange: LayoutGrid,
  wires: Route,
  size: ZoomIn,
  speed: Gauge,
  search: Search,
  power: Zap,
  board: Blocks,
  sparkle: Sparkles,
};

/**
 * The board's own colours. Gold, violet and blue are the three mode keys on
 * the toolbar, so a line announcing the modes is drawn in the colour of the
 * key the reader is about to go and press.
 *
 * This is the only colour on the window, and it is 18 pixels of it per line.
 */
const TINTS: Record<SpotlightTint, string> = {
  cyan: "#22d3ee",
  gold: "#f5b642",
  violet: "#c78bff",
  blue: "#6f9cff",
  green: "#4ade80",
  amber: "#fb923c",
};

/*
 * The window, from RecipeSearchOverlay, which is where the app's game-window
 * look is defined: a heavy frame over a near-black face with a hard drop
 * shadow. Square corners; nothing in this app is rounded.
 */
const WINDOW = "border-4 border-[#23262d] bg-[#101215] shadow-[0_8px_0_rgba(0,0,0,0.5)]";
