"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Search, X, Zap } from "lucide-react";
import { useIsCompactViewport } from "@/lib/compact-view";
import { useWorkspaceView } from "@/lib/workspace-view";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import {
  hitPlacementSettings,
  searchPowerSources,
  type PowerSearchHit,
} from "@/lib/power/power-search";
import { getPowerStructureArt } from "@/lib/power/structure-art";
import { POWER_GROUPS, POWER_SOURCES } from "@/lib/power/registry";
import type { PowerGroupId } from "@/lib/power/types";
import { GT_VOLTAGE_TIERS } from "@/lib/model";
import { GT_TIER_COLORS } from "@/components/flow/tier-colors";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { useFactoryStore } from "@/store/factory-store";
import type { MachineTier } from "@/lib/model/types";

/**
 * The power source picker: the recipe search's sibling, at the recipe
 * search's size. Browsing lays the catalog out one GROUP PER COLUMN -
 * generators, engines, boilers, turbines side by side, wrapping when the
 * panel runs out of width. Typing searches the machines AND everything they
 * take or make under any setting - so "benzene" finds every machine that
 * burns it, and picking one places the card with that fuel already dialed
 * in. Multiblocks wear the workbook's full structure renders.
 */
/** Every unlock tier the catalog actually holds, in the game's own order. */
const TIER_FILTER_OPTIONS = GT_VOLTAGE_TIERS.map((entry) => entry.tier).filter((tier) =>
  POWER_SOURCES.some((source) => source.unlock === tier),
);

export function PowerSourceOverlay() {
  const open = useFactoryStore((state) => state.powerMenuOpen);
  const closePowerMenu = useFactoryStore((state) => state.closePowerMenu);
  const addPowerSourceNode = useFactoryStore((state) => state.addPowerSourceNode);
  const compact = useIsCompactViewport();
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<PowerGroupId | "all">("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const layout = usePowerPickerViewport(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePowerMenu();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, closePowerMenu]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setGroupFilter("all");
      setTierFilter("all");
    }
  }, [open]);

  const hits = useMemo(() => {
    if (!open) {
      return [];
    }
    let all = searchPowerSources(query);
    if (groupFilter !== "all") {
      all = all.filter((hit) => hit.source.group === groupFilter);
    }
    if (tierFilter !== "all") {
      all = all.filter((hit) => hit.source.unlock === tierFilter);
    }
    return all;
  }, [open, query, groupFilter, tierFilter]);

  if (!open) {
    return null;
  }

  const searching = query.trim() !== "";
  const place = (hit: PowerSearchHit) => {
    addPowerSourceNode(hit.source.id, hitPlacementSettings(hit));
  };

  return createPortal(
    <div
      className={[
        "pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/70",
        compact ? "z-[90]" : "z-50",
        layout.sheet ? "" : "px-3 py-2",
      ].join(" ")}
      onPointerDown={closePowerMenu}
      // Like the recipe search: the dim starts where the item browser ends,
      // so the left column stays bright beside it.
      style={{ left: layout.sheet ? 0 : layout.leftInset }}
    >
      <section
        className="pointer-events-auto relative flex flex-col font-mono"
        aria-label="Power sources"
        style={{
          // Browsing is five columns at most, so past their reach the panel
          // stops and centers instead of trailing a bare right half; a
          // search fans results across everything the screen has.
          width: layout.sheet
            ? "100%"
            : `min(${searching ? layout.width : Math.min(layout.width, BROWSE_MAX_WIDTH)}px, 100%)`,
          height: layout.sheet ? "100%" : `min(${layout.height}px, 100%)`,
        }}
      >
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-4 border-[#23262d] bg-[#101215] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_rgba(255,255,255,0.05),inset_-2px_-2px_0_rgba(0,0,0,0.6)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b-2 border-[#23262d] p-2 pl-3">
            <Zap className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            <span className="shrink-0 text-sm uppercase tracking-wide">Power sources</span>
            <label className="relative ml-auto flex min-w-0 flex-1 items-center sm:max-w-[340px]">
              <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 opacity-60" aria-hidden />
              <input
                autoFocus={!compact}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Machine, fuel, or product..."
                className="h-9 w-full border-2 border-[var(--mc-33)] bg-[var(--mc-61)] pl-7 pr-2 text-sm text-[var(--mc-ink)] placeholder:text-[var(--mc-ink)]/50 focus:outline-none"
              />
            </label>
            <select
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value as PowerGroupId | "all")}
              title="Power type"
              aria-label="Power type"
              className="h-9 w-36 shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607] outline-none"
            >
              <option value="all">All types</option>
              {POWER_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <select
              value={tierFilter}
              onChange={(event) => setTierFilter(event.target.value)}
              title="Unlock tier"
              aria-label="Unlock tier"
              className="h-9 w-24 shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1.5 text-sm text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607] outline-none"
            >
              <option value="all">All tiers</option>
              {TIER_FILTER_OPTIONS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Close (Esc)"
              aria-label="Close power sources"
              onClick={closePowerMenu}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center border-2 border-[var(--mc-33)] bg-[var(--mc-61)] hover:bg-[var(--mc-85)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="recipe-search-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {searching ? (
              hits.length === 0 ? (
                <p className="p-2 text-sm text-[var(--mc-ink)]/60">
                  No power source matches. Machines are searched by name and by every fuel and
                  product they can run on.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-3">
                  {hits.map((hit) => (
                    <PowerSourceCard key={hit.source.id} hit={hit} onPlace={place} />
                  ))}
                </div>
              )
            ) : (
              // One column per group, in two shelves: the fuel-to-power path
              // up top, reactors and the exotic stuff below a quiet rule.
              GROUP_SHELVES.map((shelf, shelfIndex) => (
                <div key={shelfIndex}>
                  {shelfIndex > 0 ? (
                    <div className="mb-5 mt-7 border-t border-white/10" aria-hidden />
                  ) : null}
                  <div className="flex flex-wrap items-start gap-4">
                    {shelf.map((groupId) => {
                      const group = POWER_GROUPS.find((entry) => entry.id === groupId);
                      const groupHits = hits.filter((hit) => hit.source.group === groupId);
                      if (!group || groupHits.length === 0) {
                        return null;
                      }
                      return (
                        <div
                          key={group.id}
                          // Columns fill the row: never under 220px, and a
                          // wide screen fattens them a little instead of
                          // leaving a bare right half.
                          className="flex min-w-[220px] max-w-[300px] flex-1 basis-[220px] flex-col gap-2"
                        >
                          {/* The column's title BAR, the way a board window
                              caps what it owns - but in the power AMBER
                              with dark ink, because a grey plate over grey
                              card strips read as one more card. No letter
                              tracking: BOILERS AND EXCHANGERS must hold one
                              line at the narrowest column. */}
                          <div
                            className="flex items-center gap-1.5 border-2 border-[var(--mc-15)] px-2 py-2.5 shadow-[inset_2px_2px_0_rgba(255,255,255,0.18),inset_-2px_-2px_0_rgba(0,0,0,0.35)]"
                            // Between the first grey plate and the full
                            // bronze: a dim brass, warm enough to stand
                            // apart from the card strips, dark enough to
                            // carry light amber ink.
                            style={{ backgroundColor: "color-mix(in srgb, #d99a2b 35%, var(--mc-49) 65%)" }}
                          >
                            {/* The pixel face has one weight, so the half
                                pixel of shadow is what bold means here. */}
                            <span className="truncate text-[16px] font-black uppercase leading-none text-amber-100 [text-shadow:0.5px_0_0_currentColor]">
                              {group.name}
                            </span>
                            <span className="ml-auto text-[13px] font-black leading-none tabular-nums text-amber-100/60">
                              {groupHits.length}
                            </span>
                          </div>
                          {groupHits.map((hit) => (
                            <PowerSourceCard key={hit.source.id} hit={hit} onPlace={place} />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** The machine catalog up top; solar and endgame on the shelf below. */
const GROUP_SHELVES: PowerGroupId[][] = [
  ["burners", "turbines", "steam", "engines", "reactors"],
  ["passive", "endgame"],
];

/** The same tier badge the machine list and card headers wear. */
function TierBadge({ tier }: { tier: string }) {
  const color = GT_TIER_COLORS[tier as Exclude<MachineTier, "DEMO">];
  if (!color) {
    return (
      <span className="shrink-0 border border-[var(--mc-33)] px-1 text-[10px] uppercase text-[var(--mc-ink)]/70">
        {tier}
      </span>
    );
  }
  return (
    <span
      className="shrink-0 border px-1 text-[10px] font-bold leading-[15px]"
      style={{
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
        textDecoration: color.underline ? "underline" : undefined,
      }}
    >
      {tier}
    </span>
  );
}

function PowerSourceCard({
  hit,
  onPlace,
}: {
  hit: PowerSearchHit;
  onPlace: (hit: PowerSearchHit) => void;
}) {
  const { source, via } = hit;
  const structureArt = getPowerStructureArt(source.id);
  const icon = getPowerMachineIcon(source.id);
  return (
    <button
      type="button"
      onClick={() => onPlace(hit)}
      className="group flex w-full cursor-pointer flex-col border-2 border-[var(--mc-33)] bg-[var(--mc-71)] text-left hover:border-amber-300/70 hover:bg-[var(--mc-85)]"
    >
      {/* The structure banner: the workbook's own multiblock render, big.
          Singleblocks show their machine item instead. */}
      <span className="relative flex h-36 w-full items-center justify-center overflow-hidden border-b border-[var(--mc-33)] bg-[#0b0d10] p-2">
        {structureArt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={structureArt}
            alt=""
            draggable={false}
            className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
          />
        ) : icon?.iconPath ? (
          <span className="relative flex h-28 w-28 items-center justify-center overflow-hidden">
            <ResourceIcon
              resource={{
                kind: "item",
                id: icon.id,
                amount: 1,
                displayName: icon.displayName,
                iconPath: icon.iconPath,
                dominantColor: icon.dominantColor,
              }}
              bare
              tooltip={false}
              showAmount={false}
              showConsumedState={false}
              // 3D block renders: crop the sprite's padding without diving
              // into the block's face (same ratio as the small tiles used).
              iconPixelSize={190}
              className="!h-28 !w-28"
            />
          </span>
        ) : (
          <Zap className="h-10 w-10 text-amber-300" aria-hidden />
        )}
      </span>
      {/* Tighter than the old p-2: one name line does not need a landing. */}
      <span className="flex min-w-0 flex-col gap-0.5 px-2 py-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--mc-ink)]">
            {source.name}
          </span>
          {source.unlock ? <TierBadge tier={source.unlock} /> : null}
        </span>
        {via ? (
          // The search matched through a flow: say which one, in the stencil
          // family's cyan, with the direction as an arrow.
          <span className="flex items-center gap-1 truncate text-[11px] text-cyan-300">
            {via.direction === "takes" ? (
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <ArrowLeft className="h-3 w-3 shrink-0" aria-hidden />
            )}
            {via.direction === "takes" ? `Takes ${via.name}` : `Makes ${via.name}`}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ---- viewport: mirrors the recipe search's sizing so the two feel like one
// tool (RecipeSearchOverlay.tsx keeps the originals).

/** A CLOSED item panel leaves a 26px rail (FactoryPlannerApp's RAIL_WIDTH). */
const PICKER_RAIL_LEFT = 26;
/** Five 300px browse columns, their gaps and the frame: the browse view's reach. */
const BROWSE_MAX_WIDTH = 1620;
const PICKER_MIN_WIDTH = 640;
const PICKER_MAX_HEIGHT = 1200;
const PICKER_SHEET_BELOW = 700;

interface PickerViewport {
  sheet: boolean;
  leftInset: number;
  width: number;
  height: number;
}

function readPickerViewport(): PickerViewport {
  if (typeof window === "undefined") {
    return { sheet: false, leftInset: PICKER_RAIL_LEFT, width: 960, height: 760 };
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (viewportWidth < PICKER_SHEET_BELOW) {
    return { sheet: true, leftInset: 0, width: viewportWidth, height: viewportHeight };
  }
  // A closed item panel UNMOUNTS the aside and leaves the rail, so absence
  // means the rail's width, not the panel's.
  const browser = document.querySelector('aside[data-help-anchor="browser"]');
  const leftInset = browser
    ? Math.round(browser.getBoundingClientRect().width)
    : PICKER_RAIL_LEFT;
  return {
    sheet: false,
    leftInset,
    // No width cap: a wide screen gets more columns, not a wrapped shelf.
    width: Math.max(PICKER_MIN_WIDTH, viewportWidth - leftInset - 24),
    height: Math.min(PICKER_MAX_HEIGHT, Math.max(360, viewportHeight - 20)),
  };
}

function usePowerPickerViewport(open: boolean): PickerViewport {
  const [viewport, setViewport] = useState(readPickerViewport);
  // Closing the item panel is not a window resize: the aside unmounts and
  // the rail takes its place, so the picker re-measures on the workspace
  // flag itself and takes the room the panel gives back.
  const { leftPanelOpen } = useWorkspaceView();
  useEffect(() => {
    if (!open) {
      return;
    }
    const update = () => setViewport(readPickerViewport());
    update();
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    const element = document.querySelector('aside[data-help-anchor="browser"]');
    if (element) {
      observer.observe(element);
    }
    return () => {
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [open, leftPanelOpen]);
  return viewport;
}
