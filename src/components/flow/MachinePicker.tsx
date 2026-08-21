"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@xyflow/react";
import type { MachineHandler, MachineTier, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, formatRate, isSteamMachineHandler } from "@/lib/model";
import { ResourceIcon } from "@/components/nei/ResourceIcon";
import { GT_TIER_COLORS } from "./tier-colors";
import type { MachineHandlerIcon } from "./machine-icons";

/**
 * The machine switcher. Everything follows the app theme variables; only the
 * item icon boxes keep the fixed NEI slot chrome, matching real recipe slots.
 *
 *  - MachineTabStrip: big machine icons above the node; click switches,
 *    hover previews. The trailing "⋯" tab opens the compare table.
 *  - MachineGlanceBar: fixed-grid header row (icon | category eyebrow + name
 *    | TIME | POWER | PARALLEL). Nothing moves when the machine changes;
 *    hovering a tab previews that machine here and in the card's
 *    Total/Usage/Time lines.
 *  - MachineCompareTable: compact sortable per-recipe comparison; click a
 *    row to switch.
 */

// The NEI item-slot chrome (fixed, like the app's real recipe slots).
const SLOT = {
  background: "#8b8b8b",
  insetDark: "#373737",
  insetLight: "#ffffff",
};

// Rendered machine PNGs are 256px squares whose opaque block art spans
// exactly 114x126px (identical bounds on every machine render). Drawing the
// image at art * 256/126 crops the transparent padding exactly; the art is
// then sized a hair under its box for a small breathing margin.
const MACHINE_ART_SCALE = 256 / 126;

export function machineArtPixels(box: number): number {
  const margin = Math.max(2, Math.round(box * 0.055));
  return Math.round((box - margin * 2) * MACHINE_ART_SCALE);
}

export interface HandlerRecipeStats {
  seconds: number;
  eut: number;
  totalEu: number;
  minimumTier: string;
  /** Steam-line machine: burns steam, never EU. */
  steam: boolean;
  perfectOverclock: boolean;
  fixedParallels?: number;
  scalingParallels: { label: string; max: number }[];
  controlSummaries: { label: string; detail: string }[];
  exactOverclocks: boolean;
}

export function getHandlerRecipeStats(recipe: Recipe, handler: MachineHandler): HandlerRecipeStats {
  const applied = applyMachineHandlerToRecipe(recipe, { machineHandlerId: handler.id });
  const scalingParallels: { label: string; max: number }[] = [];
  let fixedParallels: number | undefined;
  const controlSummaries: { label: string; detail: string }[] = [];
  for (const control of applied.machineConfigControls ?? []) {
    const parallelMax = Math.max(
      0,
      ...control.tiers
        .map((tier) => tier.parallelMultiplier ?? 0)
        .filter((value) => Number.isFinite(value)),
    );
    if (parallelMax > 1) {
      if (control.id === "machineParallel") {
        fixedParallels = parallelMax;
      } else {
        scalingParallels.push({ label: control.label, max: parallelMax });
      }
    }
    const first = control.tiers[0]?.label;
    const last = control.tiers[control.tiers.length - 1]?.label;
    const effects: string[] = [];
    if (parallelMax > 1 && control.id !== "machineParallel") {
      effects.push(`up to ×${formatRate(parallelMax, 0)} parallels`);
    }
    if (
      control.tiers.some(
        (tier) => Number.isFinite(tier.durationMultiplier) && tier.durationMultiplier !== 1,
      )
    ) {
      effects.push("changes speed");
    }
    if (
      control.tiers.some((tier) => Number.isFinite(tier.eutMultiplier) && tier.eutMultiplier !== 1)
    ) {
      effects.push("changes power");
    }
    if (control.tiers.some((tier) => Number.isFinite(tier.heat))) {
      effects.push("sets heat");
    }
    controlSummaries.push({
      label: control.label,
      detail: [
        first && last && first !== last ? `${first} → ${last}` : (first ?? ""),
        effects.join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return {
    seconds: applied.durationTicks / 20,
    eut: applied.eut,
    totalEu: applied.eut * applied.durationTicks,
    minimumTier: applied.minimumTier,
    steam: isSteamMachineHandler(handler),
    perfectOverclock: applied.machineProfile?.perfectOverclock === true,
    fixedParallels,
    scalingParallels,
    controlSummaries,
    exactOverclocks:
      handler.id === recipe.machineHandlers?.[0]?.id &&
      recipe.runtimeCalculation?.status === "computed" &&
      (recipe.runtimeCalculation?.variants.length ?? 0) > 0,
  };
}

export type MachineGroup = "Manual" | "Steam" | "Electric" | "Multiblock";
const GROUP_ORDER: MachineGroup[] = ["Manual", "Steam", "Electric", "Multiblock"];

export function getMachineGroup(handler: MachineHandler): MachineGroup {
  if (handler.kind === "multiblock") {
    return "Multiblock";
  }
  if (isSteamMachineHandler(handler)) {
    return "Steam";
  }
  const tier = handler.minimumTier;
  if ((tier && tier !== "NONE") || (handler.eut ?? 0) > 0) {
    return "Electric";
  }
  return "Manual";
}

function formatSeconds(seconds: number): string {
  return seconds >= 100
    ? Math.round(seconds).toLocaleString("en-US")
    : seconds.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Big numbers shrink to k/M so they always fit their fixed cells. */
function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${formatRate(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 10_000) {
    return `${formatRate(value / 1000, value >= 100_000 ? 0 : 1)}k`;
  }
  return formatRate(value, 0);
}

function powerText(stats: HandlerRecipeStats): string {
  if (stats.steam) {
    return "steam";
  }
  return stats.eut > 0 ? `${formatCompact(stats.eut)} EU/t` : "none";
}

function TierChip({ tier, className }: { tier: string; className?: string }) {
  const color = GT_TIER_COLORS[tier as Exclude<MachineTier, "DEMO">];
  const base =
    "inline-block shrink-0 border-2 text-center font-bold shadow-[inset_1px_1px_0_rgba(255,255,255,0.45)]";
  if (!color) {
    return (
      <span
        className={[
          base,
          "min-w-[38px] border-[var(--mc-47)] bg-[var(--mc-71)] px-1 text-[10px] leading-[14px] text-[var(--mc-ink)]",
          className ?? "",
        ].join(" ")}
      >
        ANY
      </span>
    );
  }
  return (
    <span
      className={[base, "min-w-[38px] px-1 text-[10px] leading-[14px]", className ?? ""].join(" ")}
      style={{
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
        textShadow: `1px 1px 0 ${color.shadow}`,
      }}
    >
      {tier}
    </span>
  );
}

function MachineIconBox({
  icon,
  label,
  box,
}: {
  icon?: MachineHandlerIcon;
  label: string;
  box: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{
        width: box,
        height: box,
        backgroundColor: SLOT.background,
        boxShadow: `inset 2px 2px 0 ${SLOT.insetDark}, inset -2px -2px 0 ${SLOT.insetLight}`,
      }}
    >
      {icon ? (
        <ResourceIcon
          resource={{ ...icon, amount: 1 }}
          size="sm"
          bare
          showAmount={false}
          tooltip={false}
          className="!h-full !w-full"
          iconPixelSize={machineArtPixels(box)}
        />
      ) : (
        <span className="text-[12px] font-bold text-white">
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tab strip                                                           */
/* ------------------------------------------------------------------ */

export function MachineTabStrip({
  handlers,
  selectedId,
  previewId,
  iconsById,
  onHover,
  onSelect,
  onToggleCompare,
  isCompareOpen,
}: {
  handlers: MachineHandler[];
  selectedId: string;
  previewId?: string;
  iconsById: ReadonlyMap<string, MachineHandlerIcon>;
  onHover: (handlerId: string | undefined) => void;
  onSelect: (handlerId: string) => void;
  onToggleCompare: () => void;
  isCompareOpen: boolean;
}) {
  return (
    <div
      // The strip's BACKGROUND drags the node like any other card surface;
      // only the tabs themselves are interactive (they stop pointerdown).
      // A container-level nodrag made the whole top band of picker nodes
      // dead for dragging.
      // Browser tabs, not a toolbar: each machine carries its own tab and
      // nothing else does. The strip used to be one band across the node, so
      // two machines left a wide grey nothing on the right.
      // Every tab sits in its own 40px-tall slot and the baseline is painted
      // rather than bordered, so the strip is always a whole number of head
      // rows tall — one, two, however many the tabs wrap onto. That is what
      // lets the port rows below it stay on the board grid no matter how many
      // machines a recipe offers.
      // machine-tab-zone: hidden at the glance zoom step (globals.css). The
      // zone lives OUTSIDE the card's glance root, so the root's own rule
      // cannot reach it.
      className="machine-tab-zone relative flex flex-wrap content-start items-end gap-x-[3px] px-1"
      onMouseLeave={() => onHover(undefined)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[2px] bg-[var(--mc-15)]"
      />
      {handlers.map((handler) => {
        const active = handler.id === selectedId;
        const peeked = handler.id === previewId && !active;
        const icon = iconsById.get(handler.id);
        return (
          // The 40px slot is the grid unit; the tab inside it is free to be
          // whatever height reads best.
          <span key={handler.id} className="flex h-[40px] items-end">
          <button
            type="button"
            // Preview is pointer-only (focus used to flash it around clicks)
            // and only the strip's own mouseleave clears it — clearing per
            // tab made the preview blink back to the selected machine while
            // sweeping across the tiny gaps between tabs.
            onMouseEnter={() => onHover(handler.id)}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(handler.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title={handler.label}
            aria-label={`Use ${handler.label}`}
            aria-pressed={active}
            className={[
              // A browser tab: top/left/right edges only. The selected one
              // is card-colored, taller, and hangs 2px over the strip's
              // baseline so the line breaks where it sits — that break is
              // what makes it read as a tab rather than a pressed button.
              "nodrag flex items-center justify-center border-2 border-b-0 hover:brightness-110",
              active
                ? "relative z-10 h-[40px] w-[46px] border-[var(--mc-15)] bg-[var(--mc-78)] shadow-[inset_2px_2px_0_var(--mc-100)]"
                : [
                    // Stops 2px short of the baseline so the painted line
                    // runs unbroken past it; only the selected tab covers it.
                    "mb-[2px] h-[30px] w-[40px] border-[var(--mc-33)] bg-[var(--mc-56)] shadow-[inset_1px_1px_0_var(--mc-71),inset_-1px_-1px_0_var(--mc-25)]",
                    peeked ? "brightness-125" : "opacity-90",
                  ].join(" "),
            ].join(" ")}
          >
            {icon ? (
              <ResourceIcon
                resource={{ ...icon, amount: 1 }}
                size="sm"
                bare
                showAmount={false}
                tooltip={false}
                className={active ? "!h-[34px] !w-[34px]" : "!h-[26px] !w-[26px]"}
                iconPixelSize={machineArtPixels(active ? 34 : 26)}
              />
            ) : (
              <span className="text-[16px] font-bold text-[var(--mc-ink)]">
                {handler.label.slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
          </span>
        );
      })}
      <span className="flex h-[40px] items-end">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleCompare();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        data-compare-toggle
        title="Compare machines"
        aria-label="Compare all machines"
        className={[
          "nodrag mb-[2px] flex h-[34px] w-[36px] items-center justify-center border-2 border-b-0 text-[18px] font-bold leading-none hover:brightness-110",
          isCompareOpen
            ? "border-[var(--mc-15)] bg-[var(--mc-85)] text-[var(--mc-ink)] shadow-[inset_2px_2px_0_var(--mc-100)]"
            : "border-[var(--mc-33)] bg-[var(--mc-61)] text-white shadow-[inset_2px_2px_0_var(--mc-85)] [text-shadow:1px_1px_0_var(--mc-24)]",
        ].join(" ")}
      >
        ⋯
      </button>
      </span>
    </div>
  );
}

/**
 * Presentation mode's tab: the selected machine only, filling the whole
 * two-cell tab zone, purely for the icon. Not a control — it does not stop
 * pointerdown, so grabbing it drags the node like any card surface.
 */
export function MachineIconTab({
  icon,
  label,
}: {
  icon?: MachineHandlerIcon;
  label: string;
}) {
  return (
    <div className="machine-tab-zone relative flex items-end px-1">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[2px] bg-[var(--mc-15)]"
      />
      <span
        title={label}
        className="relative z-10 flex h-[40px] w-[56px] items-center justify-center border-2 border-b-0 border-[var(--mc-15)] bg-[var(--mc-78)] shadow-[inset_2px_2px_0_var(--mc-100)]"
      >
        {icon ? (
          <ResourceIcon
            resource={{ ...icon, amount: 1 }}
            size="sm"
            bare
            showAmount={false}
            tooltip={false}
            className="!h-[38px] !w-[38px]"
            iconPixelSize={machineArtPixels(38)}
          />
        ) : (
          <span className="text-[20px] font-bold text-[var(--mc-ink)]">
            {label.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Glance bar                                                          */
/* ------------------------------------------------------------------ */

export function MachineGlanceBar({
  recipe,
  category,
  handler,
  icon,
  isPreview,
}: {
  recipe: Recipe;
  category: string;
  handler: MachineHandler;
  icon?: MachineHandlerIcon;
  isPreview: boolean;
}) {
  const stats = getHandlerRecipeStats(recipe, handler);
  const parallels = stats.fixedParallels;
  return (
    <div
      className="grid h-[42px] min-w-0 items-center gap-[6px] border-2 border-[var(--mc-15)] bg-[var(--mc-61)] pl-[3px] pr-[6px] shadow-[inset_2px_2px_0_var(--mc-85),inset_-2px_-2px_0_var(--mc-47)]"
      style={{ gridTemplateColumns: "40px minmax(0,1fr) 44px 68px 48px" }}
    >
      <MachineIconBox icon={icon} label={handler.label} box={38} />
      {/* Truncates freely — the w-0/min-w-full wrapper above keeps the node
          width owned by the recipe card, never by this name. */}
      <span className="min-w-0 leading-[1.05]">
        <span className="block truncate text-[8px] font-bold uppercase tracking-[0.13em] text-white/85 [text-shadow:1px_1px_0_var(--mc-24)]">
          {category}
        </span>
        <span
          className="minecraft-title block truncate text-[13px] font-bold leading-[15px] text-white [text-shadow:1px_1px_0_var(--mc-24)]"
          title={handler.label}
        >
          {handler.label}
          {isPreview ? " ?" : ""}
        </span>
      </span>
      <GlanceCell label="TIME" value={`${formatSeconds(stats.seconds)}s`} />
      <GlanceCell label="POWER" value={powerText(stats)} dim={stats.eut <= 0} />
      <GlanceCell
        label="PARALLEL"
        value={parallels !== undefined ? `×${formatCompact(parallels)}` : "—"}
        dim={parallels === undefined}
      />
    </div>
  );
}

function GlanceCell({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <span className="overflow-hidden text-right leading-[1.1]">
      <span className="block text-[7px] font-bold tracking-[0.1em] text-white/85 [text-shadow:1px_1px_0_var(--mc-24)]">
        {label}
      </span>
      <span
        className={[
          "block whitespace-nowrap text-[11px] font-bold tabular-nums [text-shadow:1px_1px_0_var(--mc-24)]",
          dim ? "text-white/70" : "text-white",
        ].join(" ")}
      >
        {value}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Compare table                                                       */
/* ------------------------------------------------------------------ */

type SortKey = "name" | "tier" | "time" | "eut" | "parallels";

const COMPARE_COLUMNS: { key: SortKey | "controls"; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Machine" },
  { key: "tier", label: "Tier" },
  { key: "time", label: "Time", numeric: true },
  { key: "eut", label: "EU/t", numeric: true },
  { key: "parallels", label: "Parallel", numeric: true },
  { key: "controls", label: "Controls" },
];

/**
 * The "⋯" view: one compact themed table, machines grouped by power source.
 * Click a row to switch to that machine; hover previews it in the glance bar
 * and the card's stat lines.
 */
export function MachineCompareTable({
  recipe,
  handlers,
  selectedId,
  iconsById,
  onHover,
  onUse,
  onClose,
}: {
  recipe: Recipe;
  handlers: MachineHandler[];
  selectedId: string;
  iconsById: ReadonlyMap<string, MachineHandlerIcon>;
  onHover: (handlerId: string | undefined) => void;
  onUse: (handlerId: string) => void;
  onClose: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey | undefined>();
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  // The panel is UI, not a canvas object: counter-scale it against the
  // canvas zoom so it stays the same readable screen size at every zoom
  // level, instead of ballooning past small screens when zoomed in.
  const zoom = useStore((state) => state.transform[2]);
  const panelScale = 1 / Math.max(0.2, zoom);

  // If the panel would run under the app's right sidebar, hang it off the
  // node's right edge instead of its left.
  useEffect(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect && rect.right > window.innerWidth - 460) {
      setAlignRight(true);
    }
  }, []);

  // Clicking anywhere outside (or Escape) closes the panel. Capture phase so
  // canvas handlers that stop propagation cannot swallow the click.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // The "⋯" button manages its own toggle; closing here too would make
      // its click immediately reopen the panel.
      if (target?.closest?.("[data-compare-toggle]")) {
        return;
      }
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const rows = useMemo(
    () => handlers.map((handler) => ({ handler, stats: getHandlerRecipeStats(recipe, handler) })),
    [handlers, recipe],
  );

  const groups = useMemo(() => {
    if (sortKey) {
      const value = (row: (typeof rows)[number]) => {
        switch (sortKey) {
          case "time":
            return row.stats.seconds;
          case "eut":
            return row.stats.eut;
          case "parallels":
            return row.stats.fixedParallels ?? 1;
          case "tier":
            return row.stats.minimumTier;
          default:
            return row.handler.label;
        }
      };
      const sorted = [...rows].sort((left, right) => {
        const l = value(left);
        const r = value(right);
        return (l < r ? -1 : l > r ? 1 : 0) * sortDir;
      });
      return [{ group: undefined as MachineGroup | undefined, rows: sorted }];
    }
    return GROUP_ORDER.map((group) => ({
      group: group as MachineGroup | undefined,
      rows: rows.filter((row) => getMachineGroup(row.handler) === group),
    })).filter((entry) => entry.rows.length > 0);
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 1) {
        setSortDir(-1);
      } else {
        setSortKey(undefined);
        setSortDir(1);
      }
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  return (
    <div
      ref={rootRef}
      className={[
        "nodrag nowheel absolute top-full z-[140] mt-1 max-h-[360px] w-[660px] overflow-auto border-2 border-[var(--mc-15)] bg-[var(--mc-78)] p-1.5 shadow-[inset_2px_2px_0_var(--mc-100),inset_-2px_-2px_0_var(--mc-33),4px_4px_0_rgba(0,0,0,0.35)]",
        alignRight ? "right-0" : "left-0",
      ].join(" ")}
      style={{
        transform: `scale(${panelScale})`,
        transformOrigin: alignRight ? "top right" : "top left",
        maxWidth: "min(660px, 92vw)",
      }}
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Compare machines"
      onMouseLeave={() => onHover(undefined)}
    >
      <table className="w-full border-collapse text-[var(--mc-ink)]">
        <thead>
          <tr>
            {COMPARE_COLUMNS.map((column) => (
              <th
                key={column.key}
                onClick={
                  column.key === "controls" ? undefined : () => toggleSort(column.key as SortKey)
                }
                className={[
                  "select-none whitespace-nowrap border-b-2 border-[var(--mc-47)] px-1.5 py-1 text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--mc-ink-muted)]",
                  column.numeric ? "text-right" : "text-left",
                  column.key === "controls" ? "" : "cursor-pointer",
                ].join(" ")}
              >
                {column.label}
                {sortKey === column.key ? (
                  <span className="text-[var(--mc-info)]"> {sortDir > 0 ? "▲" : "▼"}</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(({ group, rows: groupRows }) => (
            <CompareGroupRows
              key={group ?? "sorted"}
              group={group}
              rows={groupRows}
              selectedId={selectedId}
              iconsById={iconsById}
              onHover={onHover}
              onUse={onUse}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareGroupRows({
  group,
  rows,
  selectedId,
  iconsById,
  onHover,
  onUse,
}: {
  group?: MachineGroup;
  rows: { handler: MachineHandler; stats: HandlerRecipeStats }[];
  selectedId: string;
  iconsById: ReadonlyMap<string, MachineHandlerIcon>;
  onHover: (handlerId: string | undefined) => void;
  onUse: (handlerId: string) => void;
}) {
  return (
    <>
      {group ? (
        <tr>
          <td
            colSpan={6}
            className="px-1.5 pb-0.5 pt-1.5 text-[7px] font-bold uppercase tracking-[0.14em] text-[var(--mc-ink-muted)]"
          >
            {group}
          </td>
        </tr>
      ) : null}
      {rows.map(({ handler, stats }) => {
        const active = handler.id === selectedId;
        const cell = [
          "whitespace-nowrap border-b border-[var(--mc-71)] px-1.5 py-1 text-[11px] tabular-nums",
          active ? "bg-[#8b70dd] text-white [text-shadow:1px_1px_0_#4a3a8a]" : "",
        ].join(" ");
        return (
          <tr
            key={handler.id}
            onMouseEnter={() => onHover(handler.id)}
            onClick={() => onUse(handler.id)}
            className="cursor-pointer hover:bg-[var(--mc-85)]"
            title={active ? `${handler.label} (in use)` : `Switch to ${handler.label}`}
          >
            <td className={cell}>
              <span className="flex items-center gap-1.5">
                <MachineIconBox
                  icon={iconsById.get(handler.id)}
                  label={handler.label}
                  box={32}
                />
                <span className="max-w-[170px] truncate font-bold">{handler.label}</span>
              </span>
            </td>
            <td className={cell}>
              <TierChip tier={stats.minimumTier} />
            </td>
            <td className={`${cell} text-right`}>{formatSeconds(stats.seconds)}s</td>
            <td className={`${cell} text-right`}>
              {stats.steam ? "steam" : stats.eut > 0 ? formatRate(stats.eut, 0) : "—"}
            </td>
            <td className={`${cell} text-right`}>
              {stats.fixedParallels !== undefined
                ? `×${formatRate(stats.fixedParallels, 0)}`
                : stats.scalingParallels.length > 0
                  ? `×${formatRate(stats.scalingParallels[0].max, 0)}`
                  : "—"}
            </td>
            <td
              className={`${cell} max-w-[200px] truncate`}
              title={
                stats.controlSummaries.length > 0
                  ? stats.controlSummaries.map((control) => control.label).join(" · ")
                  : undefined
              }
            >
              {stats.controlSummaries.length > 0
                ? stats.controlSummaries.map((control) => control.label).join(" · ")
                : "—"}
            </td>
          </tr>
        );
      })}
    </>
  );
}
