"use client";

import { Gauge, Sprout, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useFactoryStore } from "@/store/factory-store";

/**
 * The three cards that are not recipes, at the top of the items column:
 * a generator (the power catalog), a custom rate node, a crop farm. They
 * lived on the board's build tray until 2026-09-06, when the tray ran out
 * of room for the mode keys; this column is where you go to add things,
 * so this is where they belong.
 *
 * Quiet on purpose (Jack, 2026-09-06): the column's own key face (the
 * search box's border and ground), no plate behind the row and no colour
 * on the icons, so they read as three things you can put down and not as
 * a section of the column. `leading` is the column's own fold-away key,
 * which sits at the row's start rather than in the search box.
 */
export function SpawnKeys({ leading }: { leading?: ReactNode }) {
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const openPowerMenu = useFactoryStore((state) => state.openPowerMenu);
  const addCustomRateNode = useFactoryStore((state) => state.addCustomRateNode);
  const addCropFarmNode = useFactoryStore((state) => state.addCropFarmNode);
  // The columns' own hide keys' dress (the right column's "Hide" key): no
  // ground of their own, the column's border, a plain lift on hover - keys that act,
  // a step apart from the filter chips under them, which only narrow.
  const key =
    "flex h-7 min-w-0 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded border border-neutral-700 px-1 text-[12px]! leading-3 font-medium text-neutral-300 hover:border-neutral-500 hover:text-neutral-100";
  if (isReadOnly) return <div className="mx-2 mt-2 flex shrink-0 gap-1">{leading}</div>;
  return (
    <div className="mx-2 mt-2 flex shrink-0 gap-1">
      {leading}
      <button
        type="button"
        onClick={openPowerMenu}
        className={key}
        title="Place a generator"
        aria-label="Place a generator"
      >
        <Zap className="h-3 w-3 shrink-0" />
        Power
      </button>
      <button
        type="button"
        onClick={addCustomRateNode}
        className={key}
        title="Add custom rate node"
        aria-label="Add custom rate node"
      >
        <Gauge className="h-3 w-3 shrink-0" />
        Custom
      </button>
      <button
        type="button"
        onClick={addCropFarmNode}
        className={key}
        title="Add crop farm"
        aria-label="Add crop farm"
      >
        <Sprout className="h-3 w-3 shrink-0" />
        Farm
      </button>
    </div>
  );
}
