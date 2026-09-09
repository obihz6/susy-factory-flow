"use client";

import { checklistCursorStyle } from "./flow/ChecklistMode";

import { useMemo, useRef } from "react";
import { Cloud, Zap } from "lucide-react";
import { MotionNumberText } from "./flow/board-motion";
import { powerDisplayFromEuT, powerDisplaySuffix } from "@/lib/model/rate-unit";
import { GT_TIER_COLORS } from "./flow/tier-colors";
import { useMachineHandlerIcons, type MachineHandlerIcon } from "./flow/machine-icons";
import { machineArtPixels } from "./flow/MachinePicker";
import { ResourceIcon } from "./nei/ResourceIcon";
import { getSelectedMachineHandler } from "@/lib/model/recipe-rules";
import { isCustomRateRecipe } from "@/lib/model/custom-rate";
import {
  CROP_HARVESTER_INDUSTRIAL_FARM_ID,
  cropsNhEnvironmentFromTiers,
  cropsNhFarmEut,
  cropsNhHarvestTicks,
  cropsNhHarvesterFromTiers,
  cropsNhHarvesterMachineCount,
  cropsNhHarvesterTierName,
  cropsNhIsHandPicked,
  cropsNhManagerEuPerHarvest,
  getCropsNhStats,
  isCropProductionRecipe,
} from "@/lib/model/passive-production";
import { formatCompact, formatCompactStable } from "@/lib/model/resources";
import { getVoltageTierIndex } from "@/lib/model/tiers";
import type { MachineTier } from "@/lib/model/types";
import {
  getNodePowerReport,
  getNodeSteamReport,
  hasPowerReport,
  type NodePowerState,
} from "@/lib/solver/power-report";
import { getPowerMachineIcon } from "@/lib/power/planner-data";
import { useFactoryStore, useRateDisplayUnits } from "@/store/factory-store";
import { getEnergyHatchType } from "@/lib/machines/energy-hatches";
import { getHatchAmps } from "@/lib/solver/power";
import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import { listNodeSections } from "@/lib/model/shared-machine";
import { MinecraftTooltip } from "@/components/nei/MinecraftTooltip";

type VoltageTier = Exclude<MachineTier, "DEMO">;

/** A generator group's face in the list: the machine item the picker shows. */
const powerIconCache = new Map<string, MachineHandlerIcon | undefined>();
function powerMachineListIcon(sourceId: string): MachineHandlerIcon | undefined {
  if (!powerIconCache.has(sourceId)) {
    const icon = getPowerMachineIcon(sourceId);
    powerIconCache.set(
      sourceId,
      icon
        ? ({
            kind: "item",
            id: icon.id,
            displayName: icon.displayName,
            iconPath: icon.iconPath,
            dominantColor: icon.dominantColor,
          } as unknown as MachineHandlerIcon)
        : undefined,
    );
  }
  return powerIconCache.get(sourceId);
}

/**
 * One BUILD: a machine at one power configuration, summed across every card
 * that runs it. A singleblock build is its tier; a multiblock build is its
 * tier AND its hatch count, because a two-hatch reactor and a one-hatch
 * reactor are different things to construct even at the same voltage.
 */
const NEUTRAL_CHIP = {
  background: "var(--mc-85)",
  border: "var(--mc-33)",
  text: "var(--mc-ink)",
  shadow: "transparent",
};

interface BuildLine {
  key: string;
  count: number;
  hatches: number;
  /** An exotic hatch family's amp badge, worn instead of the count. */
  hatchChip?: string;
  /** The family itself, so the row can wear the hatch item's art. */
  hatchTypeId?: string;
  /** A supply TYPED as an EU/t budget rather than built from hatches. */
  typedEuT?: number;
  /** Working amps of the build, singleblocks included (arc furnaces run 3). */
  amps?: number;
  isMultiblock: boolean;
  tier?: VoltageTier;
  tierIndex: number;
  euT?: number;
  steamLs?: number;
  /** A generator build: the EU/t it MAKES, shown green where draw shows. */
  madeEuT?: number;
  /** The same figures weighted by each card's solved usage, for AVG mode. */
  avgEuT?: number;
  avgSteamLs?: number;
  avgMadeEuT?: number;
  /** Set on steam machines: bronze and high pressure are different builds. */
  pressure?: "bronze" | "high-pressure";
  state: NodePowerState;
  nodeIds: string[];
}

interface MachineGroup {
  label: string;
  icon?: MachineHandlerIcon;
  count: number;
  euT?: number;
  steamLs?: number;
  madeEuT?: number;
  avgEuT?: number;
  avgSteamLs?: number;
  avgMadeEuT?: number;
  builds: BuildLine[];
  nodeIds: string[];
  minTierIndex: number;
}

/**
 * The build list, a permanent fixture on the panel's floor — and one list
 * that reads two ways at once. Machines group by WHAT they are: every
 * electrolyzer on the board lands on one line with the total to build, the
 * fused hatch-and-tier chip and the summed draw, whichever cards they came
 * from. Only when one machine exists in more than one BUILD (an HV reactor
 * and an MV one, a one-hatch and a two-hatch) does the machine become a bare
 * name line with one sub-line per build underneath, each washed in its own
 * tier colour and carrying its own count, chip and draw. The name line adds
 * no numbers of its own: a summed figure over different builds answers no
 * question anyone shops with.
 *
 * Clicking a line jumps to its card; clicking again walks to the NEXT card
 * of that kind, so an aggregated line still leads to every board location
 * behind it.
 */
export function MachineShoppingList() {
  const project = useFactoryStore((state) => state.project);
  const checklistMode = useFactoryStore((state) => state.checklistMode);
  const lastResult = useFactoryStore((state) => state.lastResult);
  // The power column follows the power dial (EU/t or amps of a tier).
  useRateDisplayUnits();
  const focusBoardNode = useFactoryStore((state) => state.focusBoardNode);
  const machineIcons = useMachineHandlerIcons();
  // PEAK and AVERAGE, side by side (Jack, 2026-09-07): PEAK is every machine
  // at full draw at once (what the cables must carry), AVERAGE weights each
  // card by how hard the solve says it runs (what the setup burns over
  // time). Two labelled columns and a totals row on top, like a sheet - no
  // switch to flip.

  const groups = useMemo<MachineGroup[]>(() => {
    const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
    const byMachine = new Map<
      string,
      MachineGroup & { buildsByKey: Map<string, BuildLine> }
    >();

    for (const node of project.nodes) {
      if (node.enabled === false) {
        continue;
      }
      const recipe = recipesById.get(node.recipeId);
      if (!recipe || isCustomRateRecipe(recipe)) {
        continue;
      }
      const handler = getSelectedMachineHandler(recipe, node);
      // A crop card's machineCount is planted crops, not machines. What it
      // builds is the manager or farm those crops fill; a hand-picked or
      // legacy passive crop builds nothing and stays off the list.
      const cropStats = getCropsNhStats(recipe);
      const crop = cropStats
        ? cropsNhHarvesterFromTiers(
            node.machineConfigTiers,
            node.machineHandlerId,
            cropStats.minSeedBedTier,
            cropStats.subSoil !== undefined,
          )
        : undefined;
      if (crop ? cropsNhIsHandPicked(crop) : isCropProductionRecipe(recipe)) {
        continue;
      }
      // A steam machine's row bills litres, never EU: its power report would
      // only carry a phantom tier chip and a zero draw.
      const steam = getNodeSteamReport(recipe, node);
      const report =
        !steam && hasPowerReport(recipe) ? getNodePowerReport(recipe, node) : undefined;
      const count = crop
        ? cropsNhHarvesterMachineCount(crop, node.machineCount)
        : node.machineCount * Math.max(1, node.parallel);
      if (crop && count <= 0) {
        continue;
      }
      // A machine at 30% runs at full draw 30% of the time, so its
      // time-averaged burn is the nameplate figure times its solved usage.
      // At exactly 0% it never starts, so even PEAK bills it nothing; any
      // usage above zero still spikes to the full draw when it runs.
      // A SHARED MACHINE (shared-machine.ts) runs several recipes in turn:
      // its usage is its sections' time shares added up, its PEAK draw the
      // hungriest section's, its AVERAGE each section's draw weighted by
      // that section's share.
      const sections = listNodeSections(node).map(({ node: view }) => {
        const sectionRecipe = recipesById.get(view.recipeId);
        return {
          report:
            sectionRecipe && !steam && hasPowerReport(sectionRecipe)
              ? getNodePowerReport(sectionRecipe, view)
              : undefined,
          usage: Math.min(1, Math.max(0, lastResult.nodes[view.id]?.utilization ?? 1)),
        };
      });
      const usage = Math.min(
        1,
        sections.reduce((sum, section) => sum + section.usage, 0),
      );
      const runningCount = usage > 0 ? count : 0;
      const sharedPeakDrawEuT = report
        ? Math.max(...sections.map((section) => section.report?.drawEuT ?? 0), report.drawEuT)
        : undefined;
      const sharedAvgEuT = report
        ? sections.reduce(
            (sum, section) => sum + (section.report?.drawEuT ?? 0) * count * section.usage,
            0,
          )
        : undefined;
      // A generator's contribution: positive EU/t is GENERATION (the green
      // column); the parasitic machines (DEHP, fusion, the pebble reactors)
      // run a NEGATIVE figure, which is honestly just consumption and bills
      // into the draw column like any machine's.
      const powerEuT = recipe.power ? recipe.power.euPerTick : undefined;
      const madeEuT =
        powerEuT !== undefined && powerEuT >= 0 ? powerEuT * runningCount : undefined;
      // A crop harvester's draw, from the mod's own math: an Industrial Farm
      // burns `getPowerUsage` continuously spread over its seeds; a Crop
      // Manager spends `maxEUInput() / 8` on each crop it picks, so its
      // per-tick figure is that spread over the harvest period.
      const cropEuT = (() => {
        if (!crop || cropsNhIsHandPicked(crop)) {
          return undefined;
        }
        const crops = Math.max(0, Math.round(node.machineCount));
        if (crop.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID) {
          // WHOLE farms bill: a farm draws its full power however many
          // seeds it holds, so the last, partially filled farm costs the
          // same as a full one.
          return cropsNhFarmEut(crop) * cropsNhHarvesterMachineCount(crop, crops);
        }
        const stats = getCropsNhStats(recipe);
        if (!stats) {
          return undefined;
        }
        const ticks = cropsNhHarvestTicks(
          stats,
          cropsNhEnvironmentFromTiers(node.machineConfigTiers),
        );
        return Number.isFinite(ticks) && ticks > 0
          ? (cropsNhManagerEuPerHarvest(crop) * crops) / ticks
          : 0;
      })();
      const euT = report
        ? (sharedPeakDrawEuT ?? report.drawEuT) * runningCount
        : cropEuT !== undefined
          ? usage > 0
            ? cropEuT
            : 0
          : powerEuT !== undefined && powerEuT < 0
            ? -powerEuT * runningCount
            : undefined;
      const steamLs = steam ? steam.drawSteamPerTick * 20 * runningCount : undefined;

      const group =
        byMachine.get(handler.label) ??
        (() => {
          const created = {
            label: handler.label,
            icon: undefined as MachineHandlerIcon | undefined,
            count: 0,
            euT: undefined as number | undefined,
            steamLs: undefined as number | undefined,
            madeEuT: undefined as number | undefined,
            avgEuT: undefined as number | undefined,
            avgSteamLs: undefined as number | undefined,
            avgMadeEuT: undefined as number | undefined,
            builds: [],
            nodeIds: [],
            minTierIndex: Number.POSITIVE_INFINITY,
            buildsByKey: new Map<string, BuildLine>(),
          };
          byMachine.set(handler.label, created);
          return created;
        })();
      group.icon ??= recipe.power
        ? powerMachineListIcon(recipe.power.sourceId)
        : machineIcons.get(handler.id);
      group.count += count;
      group.nodeIds.push(node.id);
      if (euT !== undefined) {
        group.euT = (group.euT ?? 0) + euT;
        group.avgEuT = (group.avgEuT ?? 0) + (sharedAvgEuT ?? euT * usage);
      }
      if (steamLs !== undefined) {
        group.steamLs = (group.steamLs ?? 0) + steamLs;
        group.avgSteamLs = (group.avgSteamLs ?? 0) + steamLs * usage;
      }
      if (madeEuT !== undefined) {
        group.madeEuT = (group.madeEuT ?? 0) + madeEuT;
        group.avgMadeEuT = (group.avgMadeEuT ?? 0) + madeEuT * usage;
      }

      // The stacking rule: singleblocks of one tier are one build; a
      // multiblock's hatch count splits it further. A steam multiblock splits
      // on its pressure: a bronze build and a steel one are different things
      // to construct.
      // A crop harvester's build is its tier: an LV manager and an HV manager
      // are different things to construct, exactly like powered machines.
      const cropTier = crop
        ? (cropsNhHarvesterTierName(crop.tierIndex) as VoltageTier)
        : undefined;
      // A generator's build is its tier setting where it has one (an LV and
      // an HV gas turbine are different things to construct); multiblock
      // generators are one build each.
      const powerTierSetting = recipe.power ? node.machineConfigTiers?.tier : undefined;
      const powerTier =
        powerTierSetting && getVoltageTierIndex(powerTierSetting as VoltageTier) >= 0
          ? (powerTierSetting as VoltageTier)
          : undefined;
      const buildKey = report
        ? `${report.tier}|${report.isMultiblock ? (report.typedBudget ? `eu:${report.poolEuT}` : (report.hatchChip ?? report.hatches)) : "single"}`
        : steam
          ? `steam|${steam.highPressure ? "high" : "bronze"}`
          : cropTier
            ? `crop|${cropTier}`
            : recipe.power
              ? `power|${powerTier ?? "block"}`
              : "plain";
      // Steam machines sort with ULV: they are the start of the game, not the
      // end of the list a missing tier would banish them to.
      const tierIndex = report
        ? getVoltageTierIndex(report.tier)
        : steam
          ? 0
          : (cropTier ?? powerTier)
            ? getVoltageTierIndex((cropTier ?? powerTier)!)
            : Number.POSITIVE_INFINITY;
      group.minTierIndex = Math.min(group.minTierIndex, tierIndex);
      const build =
        group.buildsByKey.get(buildKey) ??
        (() => {
          const created: BuildLine = {
            key: `${handler.label}|${buildKey}`,
            count: 0,
            hatches: report?.hatches ?? 1,
            hatchChip: report?.hatchChip,
            typedEuT: report?.isMultiblock && report.typedBudget ? report.poolEuT : undefined,
            hatchTypeId: report?.isMultiblock
              ? getEnergyHatchType(node.energyHatchType).id
              : undefined,
            amps: report?.amps,
            isMultiblock:
              report?.isMultiblock ??
              steam?.isMultiblock ??
              crop?.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID,
            tier: report?.tier ?? cropTier ?? powerTier,
            tierIndex,
            euT: undefined,
            steamLs: undefined,
            madeEuT: undefined,
            avgEuT: undefined,
            avgSteamLs: undefined,
            avgMadeEuT: undefined,
            pressure: steam ? (steam.highPressure ? "high-pressure" : "bronze") : undefined,
            state: "ok",
            nodeIds: [],
          };
          group.buildsByKey.set(buildKey, created);
          group.builds.push(created);
          return created;
        })();
      build.count += count;
      build.nodeIds.push(node.id);
      if (euT !== undefined) {
        build.euT = (build.euT ?? 0) + euT;
        build.avgEuT = (build.avgEuT ?? 0) + euT * usage;
      }
      if (steamLs !== undefined) {
        build.steamLs = (build.steamLs ?? 0) + steamLs;
        build.avgSteamLs = (build.avgSteamLs ?? 0) + steamLs * usage;
      }
      if (madeEuT !== undefined) {
        build.madeEuT = (build.madeEuT ?? 0) + madeEuT;
        build.avgMadeEuT = (build.avgMadeEuT ?? 0) + madeEuT * usage;
      }
      if (report && report.state !== "ok" && build.state === "ok") {
        build.state = report.state;
      }
    }

    const list = [...byMachine.values()];
    // Ordered by PEAK, the column the cables are sized from.
    for (const group of list) {
      group.builds.sort(
        (a, b) => a.tierIndex - b.tierIndex || (b.euT ?? 0) - (a.euT ?? 0),
      );
    }
    list.sort(
      (a, b) =>
        a.minTierIndex - b.minTierIndex ||
        (b.euT ?? 0) - (a.euT ?? 0) ||
        a.label.localeCompare(b.label),
    );
    return list;
  }, [lastResult, machineIcons, project]);

  // Click-to-cycle state: which card of a line the last click landed on.
  // A ref, not state — advancing it must not re-render the list.
  const cycleRef = useRef(new Map<string, number>());
  const focusNext = (key: string, nodeIds: string[]) => {
    const next = ((cycleRef.current.get(key) ?? -1) + 1) % nodeIds.length;
    cycleRef.current.set(key, next);
    const nodeId = nodeIds[next];
    if (nodeId) {
      focusBoardNode(nodeId);
    }
  };

  const totalMachines = groups.reduce((sum, group) => sum + group.count, 0);
  // Presence gates what shows, never the value: a figure whose machines
  // exist stays up and reads 0 rather than vanishing when everything idles.
  const hasEu = groups.some((group) => group.euT !== undefined);
  const hasSteam = groups.some((group) => group.steamLs !== undefined);
  const sum = (pick: (group: MachineGroup) => number | undefined) =>
    groups.reduce((total, group) => total + (pick(group) ?? 0), 0);
  const totals = {
    euT: sum((group) => group.euT),
    avgEuT: sum((group) => group.avgEuT),
    steamLs: sum((group) => group.steamLs),
    avgSteamLs: sum((group) => group.avgSteamLs),
    madeEuT: sum((group) => group.madeEuT),
    avgMadeEuT: sum((group) => group.avgMadeEuT),
  };
  const hasMade = groups.some((group) => group.madeEuT !== undefined);
  if (totalMachines === 0) {
    return null;
  }

  return (
    <div
      data-help-anchor="machines"
      className="flex min-h-0 shrink-0 basis-[40%] flex-col border-t-2 border-[var(--mc-47)]"
    >
      <div className="border-b border-[var(--mc-47)] bg-[var(--mc-71)] px-2 pb-1 pt-1">
        {/* The sheet's head: the title on the left, the two column labels
            over their columns on the right. */}
        <div className="flex w-full items-end gap-1.5">
          <span className="min-w-0 flex-1 text-sm font-bold uppercase tracking-wider">Machines</span>
          <span className={COLUMN_HEAD_CLASS}>Peak</span>
          <span className={COLUMN_HEAD_CLASS}>Average</span>
        </div>
        {/* The totals, on top like a sheet: one row when the board only
            draws, three (used, made, net) once a generator sits on it, and
            a steam row whenever a steam machine does. */}
        {hasSteam ? (
          <TotalLine label="Steam" peak={{ steamLs: totals.steamLs }} average={{ steamLs: totals.avgSteamLs }} />
        ) : null}
        {hasEu || hasMade ? (
          <TotalLine
            label={hasMade ? "Used" : "Total"}
            peak={{ euT: totals.euT }}
            average={{ euT: totals.avgEuT }}
          />
        ) : null}
        {hasMade ? (
          <>
            <TotalLine label="Made" peak={{ madeEuT: totals.madeEuT }} average={{ madeEuT: totals.avgMadeEuT }} />
            <TotalLine
              label="Net"
              peak={{ netEuT: totals.madeEuT - totals.euT }}
              average={{ netEuT: totals.avgMadeEuT - totals.avgEuT }}
            />
          </>
        ) : null}
      </div>
      {/* overflow-x hidden outright: Windows overlay scrollbars float over
          content, so a row even a pixel wide of the column summons a
          horizontal bar across the list. Nothing here is allowed to scroll
          sideways; the name column truncates instead. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1">
        {groups.map((group) => {
          const uniform = group.builds.length === 1;
          const build = group.builds[0];
          return (
            <div key={group.label} className="py-0.5">
              <ListLine
                icon={group.icon}
                // A uniform group is one whole line: count, chip, draw,
                // warning. A mixed one is a bare NAME — its counts and
                // numbers all live on the build sub-lines below.
                count={uniform ? group.count : undefined}
                label={group.label}
                chip={uniform ? build : undefined}
                peak={uniform ? { euT: build?.euT, madeEuT: build?.madeEuT, steamLs: build?.steamLs } : undefined}
                average={uniform ? { euT: build?.avgEuT, madeEuT: build?.avgMadeEuT, steamLs: build?.avgSteamLs } : undefined}
                state={uniform ? (build?.state ?? "ok") : "ok"}
                wash={uniform && build && !build.isMultiblock ? build.tier : undefined}
                checklist={checklistMode ? group.nodeIds.every((id) => project.checklist?.cards.includes(id)) : undefined}
                onClick={() => checklistMode ? useFactoryStore.getState().toggleChecklist("cards", group.nodeIds) : focusNext(group.label, group.nodeIds)}
              />
              {uniform
                ? null
                : group.builds.map((buildLine, index) => (
                    <ListLine
                      key={buildLine.key}
                      indent
                      isLast={index === group.builds.length - 1}
                      count={buildLine.count}
                      // A steam build has no tier chip; the pressure is the
                      // build, so the sub-line says it in words.
                      label={
                        buildLine.pressure === "high-pressure"
                          ? "High pressure"
                          : buildLine.pressure === "bronze"
                            ? "Bronze"
                            : undefined
                      }
                      chip={buildLine}
                      peak={{ euT: buildLine.euT, madeEuT: buildLine.madeEuT, steamLs: buildLine.steamLs }}
                      average={{ euT: buildLine.avgEuT, madeEuT: buildLine.avgMadeEuT, steamLs: buildLine.avgSteamLs }}
                      state={buildLine.state}
                      wash={buildLine.isMultiblock ? undefined : buildLine.tier}
                      checklist={checklistMode ? buildLine.nodeIds.every((id) => project.checklist?.cards.includes(id)) : undefined}
                      onClick={() => checklistMode ? useFactoryStore.getState().toggleChecklist("cards", buildLine.nodeIds) : focusNext(buildLine.key, buildLine.nodeIds)}
                    />
                  ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One figure of a line: what it draws, makes, or burns. */
interface Figure {
  euT?: number;
  madeEuT?: number;
  steamLs?: number;
  /** A totals row's difference: signed, green up, red down. */
  netEuT?: number;
}

/** The two right-hand columns share one width so every row lines up. */
const COLUMN_CLASS = "w-[76px] shrink-0 whitespace-nowrap text-right tabular-nums";
const COLUMN_HEAD_CLASS =
  COLUMN_CLASS + " text-[10px] font-bold uppercase tracking-wider text-[var(--mc-ink-muted)]";

/**
 * A figure in its column: the energy's mark, the number, its unit. A
 * generator's make is green, a net is signed. Empty when the line has no
 * such figure, so the columns still line up.
 */
function FigureCell({ figure, className }: { figure?: Figure; className?: string }) {
  const value =
    figure?.netEuT ?? figure?.madeEuT ?? figure?.euT ?? figure?.steamLs;
  if (value === undefined) {
    return <span className={[COLUMN_CLASS, className ?? ""].join(" ")} />;
  }
  const steam = figure?.steamLs !== undefined && figure.euT === undefined && figure.madeEuT === undefined && figure.netEuT === undefined;
  const made = figure?.madeEuT !== undefined;
  const net = figure?.netEuT !== undefined;
  const tone = net
    ? value >= 0
      ? "text-emerald-300"
      : "text-red-300"
    : made
      ? "text-emerald-300"
      : "";
  const shownValue = steam ? value : powerDisplayFromEuT(Math.abs(value));
  const text = (shown: number, settled: boolean) => {
    const number = settled ? formatCompact(shownValue) : formatCompactStable(shown);
    return net ? `${value >= 0 ? "+" : "-"}${number}` : made ? `+${number}` : number;
  };
  return (
    <span className={[COLUMN_CLASS, tone, className ?? ""].join(" ")}>
      {steam ? <SteamMark /> : <EuMark />}
      <MotionNumberText
        values={[shownValue]}
        render={(shown) => text(shown[0] ?? shownValue, shown[0] === shownValue)}
      />
      <span className="ml-0.5 text-[8px] font-normal text-[var(--mc-ink-muted)]">
        {steam ? "L/s" : powerDisplaySuffix()}
      </span>
    </span>
  );
}

/** A totals row of the sheet's head: a label, then both columns. */
function TotalLine({ label, peak, average }: { label: string; peak: Figure; average: Figure }) {
  return (
    <div className="flex w-full items-center gap-1.5 text-[13px] font-bold leading-5">
      <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-wider text-[var(--mc-ink-muted)]">
        {label}
      </span>
      <FigureCell figure={peak} />
      <FigureCell figure={average} />
    </div>
  );
}

/**
 * EU/t and L/s sit a few pixels apart in this list and read alike at a
 * glance, so each figure wears its energy's mark: a bolt for EU, steam for
 * litres. The units themselves stay as they are - power is a per-tick fact,
 * steam a per-second one.
 */
function EuMark() {
  return <Zap aria-hidden className="mr-0.5 inline h-2.5 w-2.5 -translate-y-px text-amber-400" />;
}

function SteamMark() {
  // A little grey cloud, filled: steam is a gas, and at ten pixels a solid
  // silhouette reads where an outline or a droplet does not.
  return (
    <Cloud
      aria-hidden
      className="mr-0.5 inline h-2.5 w-2.5 -translate-y-px fill-current text-slate-300"
    />
  );
}

function ListLine({
  icon,
  indent = false,
  isLast = false,
  count,
  label,
  chip,
  peak,
  average,
  state,
  wash,
  onClick,
  checklist,
}: {
  icon?: MachineHandlerIcon;
  /** A build sub-line: the icon column carries the tree branch instead. */
  indent?: boolean;
  /** The last sub-line closes its branch with an L instead of a T. */
  isLast?: boolean;
  /** Absent on a mixed machine's name line; "1×" is otherwise said out loud. */
  count?: number;
  label?: string;
  /** The fused hatch-and-tier chip, when this line is one build. */
  chip?: Pick<BuildLine, "tier" | "hatches" | "hatchChip" | "hatchTypeId" | "amps" | "isMultiblock" | "typedEuT">;
  /** The line's two columns: full draw, and the solve-weighted draw. */
  peak?: Figure;
  average?: Figure;
  state: NodePowerState;
  /** Tier whose colour faintly washes the whole line. */
  wash?: VoltageTier;
  onClick: () => void;
  checklist?: boolean;
}) {
  const stalled = state !== "ok";
  // A multiblock's supply is a number, not a tier, so its chip wears the
  // neutral plate; a singleblock's chip is its tier's colour.
  const chipColor = chip?.tier
    ? chip.isMultiblock
      ? NEUTRAL_CHIP
      : GT_TIER_COLORS[chip.tier]
    : undefined;
  // What the line's build means, in one breath: what supplies the power, its
  // amps, the EU/t they buy, and both draw figures. Singleblocks get the same
  // story with the machine itself in the hatch's place.
  const hatchType = chip?.isMultiblock ? getEnergyHatchType(chip.hatchTypeId) : undefined;
  const hatchAmps =
    chip?.amps ??
    (hatchType ? (hatchType.exotic ? hatchType.amps : getHatchAmps(chip?.hatches ?? 1)) : undefined);
  // A multiblock's supply is one number: the typed EU/t, or what its stored
  // hatches add up to.
  const supplyEuT =
    chip?.typedEuT ??
    (chip?.tier && hatchAmps !== undefined ? getVoltageTierMaxEuT(chip.tier) * hatchAmps : 0);
  const peakEuT = peak?.euT;
  const averageEuT = average?.euT;
  const tierBadge =
    chip?.tier && chipColor ? (
      <span
        className="border px-1 text-[10px] font-bold leading-[15px]"
        style={{
          backgroundColor: chipColor.background,
          borderColor: chipColor.border,
          color: chipColor.text,
          textShadow: `1px 1px 0 ${chipColor.shadow}`,
        }}
      >
        {chip.tier}
      </span>
    ) : null;
  const hatchStory =
    chip?.tier && hatchAmps !== undefined ? (
      <div className="w-max max-w-[280px]">
        {count !== undefined ? (
          <div className="text-[13px] font-semibold text-white">
            {count}× {count === 1 ? "machine" : "machines"}
          </div>
        ) : null}
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-white">
          {chip.isMultiblock ? (
            <span>Supplied {formatCompact(supplyEuT)} EU/t</span>
          ) : (
            <>
              {tierBadge}
              <span>Machine</span>
            </>
          )}
        </div>
        {!chip.isMultiblock ? (
          <div className="mt-0.5 text-[11px] leading-4 text-slate-300">
            {formatCompact(hatchAmps)} A:{" "}
            <span className="font-bold text-white">{formatCompact(supplyEuT)} EU/t</span>
          </div>
        ) : null}
        {peakEuT !== undefined ? (
          <>
            <div className="text-[11px] leading-4 text-slate-300">
              PEAK <span className="font-bold text-white">{formatCompact(peakEuT)} EU/t</span>
            </div>
            <div className="text-[11px] leading-4 text-slate-300">
              AVG{" "}
              <span className="font-bold text-white">{formatCompact(averageEuT ?? 0)} EU/t</span>
            </div>
          </>
        ) : null}
      </div>
    ) : undefined;

  // The whole LINE answers the hover, not just the chip: the build's power
  // story is about the row, and a target the width of a chip made the panel
  // feel like a secret.
  return (
    <MinecraftTooltip content={checklist === undefined ? hatchStory : checklist ? "Completed — click to restore" : "Click to mark these machines complete"}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={checklist}
        data-checklist-done={checklist}
        data-checklist-row={checklist !== undefined ? "true" : undefined}
        // The wash sits at ~12% - present enough to read as the tier's
        // colour without competing with the chips that name it.
        style={{ ...checklistCursorStyle, ...(wash ? { backgroundColor: `${GT_TIER_COLORS[wash].background}1f` } : {}) }}
        className="relative flex w-full items-center gap-1.5 py-0.5 pl-2 pr-2 text-left hover:bg-[var(--mc-71)]"
      >
        {indent ? (
          /* The branch: a vertical line dropping from under the parent's
             icon, elbowing out to this build's count. Anchored to the
             BUTTON's box (inset-y-0), not the flex row - the row's box
             stops at the padding, and the 4px of it between rows is
             exactly the gap that used to chop the stem into dashes. The
             last build stops at its elbow, closing the stem in an L. */
          <>
            <span aria-hidden className="absolute bottom-0 left-2 top-0 w-[24px] opacity-60">
              <span
                className={[
                  "absolute left-[11px] top-0 w-[2px] bg-[var(--mc-ink-muted)]",
                  isLast ? "h-[calc(50%+1px)]" : "bottom-0",
                ].join(" ")}
              />
              <span className="absolute left-[11px] right-0 top-1/2 h-[2px] -translate-y-[1px] bg-[var(--mc-ink-muted)]" />
            </span>
            <span className="w-[24px] shrink-0" />
          </>
        ) : (
          <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center overflow-hidden">
            {icon ? (
              <ResourceIcon
                resource={{ ...icon, amount: 1, consumed: true }}
                size="sm"
                showAmount={false}
                bare
                tooltip={false}
                // Machine renders are 256px squares whose art fills barely
                // half the frame; asked for raw, the row showed a 12px
                // machine swimming in margin. machineArtPixels crops the
                // transparent frame exactly, so the art fills the box.
                iconPixelSize={machineArtPixels(24)}
                className="!h-full !w-full"
              />
            ) : null}
          </span>
        )}
        {count !== undefined ? (
          <span className="shrink-0 text-[14px] font-bold tabular-nums">{count}×</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[14px] leading-6">
          {label ?? ""}
        </span>
        {chipColor && chip && !chip.isMultiblock ? (
          /* The card's own chip, verbatim: hatch count fused left of the
             tier, one paint job, so the panel and the board read as one.
             Always in the right-hand column, so every chip on the list sits
             on one line however the rows around it are shaped. */
          <span className="flex shrink-0 items-center">
            {/* A multiblock's chip is its supply, in the neutral plate the
                card's own chip wears; a singleblock's is its tier. */}
            <span
              className="h-5 border-2 px-1.5 text-[11px] font-bold leading-4"
              style={{
                backgroundColor: chipColor.background,
                borderColor: chipColor.border,
                color: chipColor.text,
                textShadow: `1px 1px 0 ${chipColor.shadow}`,
              }}
            >
              {chip.isMultiblock ? `${formatCompact(supplyEuT)} EU/t` : chip.tier}
            </span>
          </span>
        ) : null}
        {stalled ? (
          <span className={[COLUMN_CLASS, "font-bold text-red-400"].join(" ")}>
            {state === "under-powered" ? "LOW!" : "TIER!"}
          </span>
        ) : (
          <FigureCell figure={peak} className="text-[13px]" />
        )}
        <FigureCell figure={stalled ? undefined : average} className="text-[13px]" />
      </button>
    </MinecraftTooltip>
  );
}
