"use client";

import type { ReactNode } from "react";
import type { EntryIcon, PlanResourceStat } from "@/lib/community/types";
import type { MachineTier } from "@/lib/model/types";
import { formatSlotRate } from "@/components/flow/flow-explainers";
import { GT_TIER_COLORS } from "@/components/flow/tier-colors";
import { fluidArtPixels, isSwatchFluid, ResourceIcon } from "@/components/nei/ResourceIcon";

/**
 * Everything the Setups and Pockets shelves render the same way: tag
 * chips, tier badges, the Needs/Makes stat sections, and the one hover
 * card a whole row reveals.
 */

export function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return "";
  }
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 86400 * 30) {
    return `${Math.floor(seconds / 86400)}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}

/** A row's tags as small chips; clicking one searches for it (`#tag`).
    They opt out of the row's hover card — a chip is its own control. */
export function TagChips({
  tags,
  onTag,
  className,
}: {
  tags: string[];
  onTag: (tag: string) => void;
  className?: string;
}) {
  if (tags.length === 0) {
    return null;
  }
  return (
    <div className={["mt-0.5 flex flex-wrap gap-1", className ?? ""].join(" ")}>
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          data-tooltip-stop=""
          onClick={() => onTag(tag)}
          title={`Search #${tag}`}
          className="rounded-[3px] border border-neutral-700 bg-[#17191d] px-1 py-px text-[9px] leading-3 text-neutral-400 hover:border-cyan-600 hover:text-cyan-300"
        >
          #{tag}
        </button>
      ))}
    </div>
  );
}

export type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * The GT voltage badge, worn exactly like the tier button on a card — and a
 * fixed column: every badge is as wide as the widest tier label, so the
 * text after them all starts on the same line.
 */
export const TIER_BADGE_WIDTH = "w-8";

export function TierBadge({ tier }: { tier?: VoltageTier }) {
  const color = tier ? GT_TIER_COLORS[tier] : undefined;
  if (!tier || !color) {
    return <span className={`${TIER_BADGE_WIDTH} shrink-0`} aria-hidden />;
  }
  return (
    <span
      className={`${TIER_BADGE_WIDTH} shrink-0 border text-center text-[9px] font-bold leading-[14px] shadow-[inset_1px_1px_0_rgba(255,255,255,0.55),inset_-1px_-1px_0_rgba(0,0,0,0.45)]`}
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

/** One Needs/Makes column: a heading and its resource lines. */
function IoSection({
  label,
  stats,
  limit,
  muted,
}: {
  label: string;
  stats: PlanResourceStat[];
  limit: number;
  /** Renders the heading even when empty; used by the side-by-side layout
      so the two columns keep their headings aligned. */
  muted?: boolean;
}) {
  if (stats.length === 0 && !muted) {
    return null;
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      {stats.length === 0 ? (
        <div className="py-0.5 text-[11px] text-slate-500">Nothing</div>
      ) : null}
      {stats.slice(0, limit).map((stat) => (
        <div key={`${stat.kind}:${stat.resourceId}`} className="flex items-center gap-1.5 py-0.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
            <ResourceIcon
              resource={{ ...stat, id: stat.resourceId, amount: 1 }}
              bare
              tooltip={false}
              showAmount={false}
              iconPixelSize={
                stat.kind === "fluid" ? (isSwatchFluid(stat) ? 36 : fluidArtPixels(20)) : undefined
              }
              className={stat.kind === "fluid" ? "!h-5 !w-5" : "!h-5 !w-5 origin-center scale-[1.125]"}
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200">
            {stat.displayName ?? stat.resourceId}
          </span>
          <span className="shrink-0 tabular-nums text-[12px] text-slate-400">
            {formatSlotRate(stat.ratePerSecond, stat.kind)}
          </span>
        </div>
      ))}
      {stats.length > limit ? (
        <div className="text-[10px] text-slate-500">+{stats.length - limit} more</div>
      ) : null}
    </div>
  );
}

/**
 * The Needs/Makes stat sections, shared by rows, dialogs and hover cards.
 * Stacked by default; `side-by-side` puts needs left and makes right, for
 * anywhere with the width to spare.
 */
export function renderIoStats(
  needs: PlanResourceStat[],
  outputs: PlanResourceStat[],
  options: { layout?: "stacked" | "side-by-side"; limit?: number } = {},
): ReactNode {
  if (needs.length === 0 && outputs.length === 0) {
    return undefined;
  }

  const limit = options.limit ?? 8;
  if (options.layout === "side-by-side") {
    return (
      <div className="flex gap-4">
        <IoSection label="Needs" stats={needs} limit={limit} muted />
        <IoSection label="Makes" stats={outputs} limit={limit} muted />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <IoSection label="Needs" stats={needs} limit={limit} />
      <IoSection label="Makes" stats={outputs} limit={limit} />
    </div>
  );
}

/**
 * The whole story a hovered row tells: icon and full title (names truncate
 * in a 344px column), who made it and when, the headline numbers with the
 * tier in its GT colour, the description, then Needs/Makes.
 */
export function renderEntryHoverCard(entry: {
  icon?: EntryIcon;
  name: string;
  authorName?: string;
  createdAt?: string;
  cardCount: number;
  machineCount: number;
  tier?: VoltageTier;
  gameVersion?: string;
  description?: string;
  needs?: PlanResourceStat[];
  outputs?: PlanResourceStat[];
}): ReactNode {
  return (
    // Wide enough that each of the two resource columns gets the room the
    // old single stacked column had, so nothing wraps or truncates.
    <div className="w-[34rem]">
      <div className="flex items-center gap-2">
        {entry.icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden">
            <ResourceIcon
              resource={{
                id: entry.icon.resourceId,
                kind: entry.icon.kind,
                amount: 1,
                displayName: entry.icon.displayName,
                iconPath: entry.icon.iconPath,
                iconAtlas: entry.icon.iconAtlas,
                dominantColor: entry.icon.dominantColor,
              }}
              bare
              tooltip={false}
              showAmount={false}
              className="!h-full !w-full"
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-4 text-white">{entry.name}</div>
          {entry.authorName || entry.createdAt ? (
            <div className="mt-0.5 text-[10px] text-slate-400">
              {entry.authorName ? `by ${entry.authorName}` : ""}
              {entry.authorName && entry.createdAt ? ", " : ""}
              {entry.createdAt ? formatRelativeDate(entry.createdAt) : ""}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] tabular-nums text-slate-400">
        <span>{entry.cardCount} cards</span>
        <span>{entry.machineCount} machines</span>
        {entry.tier ? <TierBadge tier={entry.tier} /> : null}
        {entry.gameVersion ? (
          <span className="ml-auto shrink-0 truncate">SUSY {entry.gameVersion}</span>
        ) : null}
      </div>
      {entry.description ? (
        <p className="mt-1.5 max-h-28 overflow-hidden whitespace-pre-wrap text-[11px] leading-4 text-slate-300">
          {entry.description}
        </p>
      ) : null}
      <div className="mt-2">
        {renderIoStats(entry.needs ?? [], entry.outputs ?? [], { layout: "side-by-side" })}
      </div>
    </div>
  );
}
