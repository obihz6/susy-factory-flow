import { getEnergyHatchType } from "@/lib/machines/energy-hatches";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import { formatCompact } from "@/lib/model/resources";
import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import type { MachineTier, Recipe } from "@/lib/model/types";
import { getHeatDiscountMultiplier } from "./heat";
import { getEffectiveVoltageOrdinal } from "./power";
import { getMachineEutMultiplier } from "./machine-effects";
import { getOverclockedRecipeStats } from "./overclock";
import { getNodePowerReport, describePowerStall, type NodePowerReport } from "./power-report";
import {
  powerNodeAtBudget,
  listPowerWinsCached,
  nextPowerWin,
  previousPowerWin,
  type PowerWin,
  type PowerWinNode,
} from "./power-wins";

type VoltageTier = Exclude<MachineTier, "DEMO">;

/**
 * EVERY HATCH IS AN EU/t FIGURE (Jack, 2026-09-07): a regular hatch of tier
 * T carries 2 amps of T's voltage, an exotic hatch its whole rating of
 * them. The calculator adds and subtracts these from the card's number and
 * remembers nothing.
 */
export function hatchEuT(tier: string, familyId: string): number {
  return getVoltageTierMaxEuT(tier as VoltageTier) * getEnergyHatchType(familyId).amps;
}

/** The row's name: the tier alone for a plain hatch, the rating for an exotic. */
export function hatchRowLabel(tier: string, familyId: string): string {
  const type = getEnergyHatchType(familyId);
  if (!type.exotic) {
    return tier;
  }
  return `${tier} ${type.chip}${type.id.startsWith("laser") ? " Laser" : ""}`;
}

/**
 * One rung of the ladder: what the recipe is on its own, and what it is with
 * this supply. The ladder follows the game's own order (the wiki's
 * "Parallels" section): discount, then parallels, then overclocks, then
 * what falls out of those.
 */
export interface PowerLadderRow {
  id: string;
  label: string;
  /** The bare recipe's figure. */
  recipe: string;
  /** The figure with this supply. */
  supplied: string;
  /** Why the row is here, in plain words, for the hover. */
  help: string;
  /** The bottom line, set in bolder ink. */
  emphasis?: boolean;
}

export interface PowerWorking {
  budgetEuT: number;
  report: NodePowerReport;
  /** What the number is read as: "EV × 2.93 A". */
  readAs: string;
  /** What the machine actually pulls at this supply, in words. */
  draw: string;
  /** The same as a number. */
  drawEuT: number;
  rows: PowerLadderRow[];
  /**
   * The wiki's own advice, with the numbers filled in: when the last step
   * bought was imperfect, two machines one step lower make the same output
   * for half the power. Absent when it does not apply.
   */
  hint?: string;
  /** The stall reason when the build does not run. */
  stall?: string;
  /** The win the budget stands on (its floor), and the next one up. */
  previousWin?: PowerWin;
  nextWin?: PowerWin;
  /**
   * How far the budget has climbed from the last win toward the next, 0..1
   * on a log scale - the bar's fill. 1 when there is nothing left to buy.
   */
  progress: number;
}

function compact(value: number): string {
  return formatCompact(value);
}

function ticks(value: number): string {
  if (value >= 1) {
    return `${compact(value)} t`;
  }
  // Under one tick the machine runs whole recipes a tick: 1/2 t, 1/7 t.
  return `1/${Math.round(1 / value)} t`;
}

/**
 * The working for one budget, as the game applies it: the discount, the
 * parallels it pays for, the overclocks the rest buys, and what those do to
 * time, energy per run, draw and output. Every value comes from the same
 * functions the card runs on, so the panel can never disagree with the
 * board.
 */
export function describePowerWorking(
  recipe: Recipe,
  node: PowerWinNode,
  budgetEuT: number,
): PowerWorking {
  const budgeted = powerNodeAtBudget(node, budgetEuT);
  const report = getNodePowerReport(recipe, budgeted);
  const stats = getOverclockedRecipeStats(recipe, budgeted);
  const effective = recipe.machineType ? applyMachineHandlerToRecipe(recipe, budgeted) : recipe;
  const tier = report.tier;
  const voltage = getVoltageTierMaxEuT(tier);
  const amps = budgetEuT / voltage;
  const parallels = Math.max(1, report.parallels);
  const baseEuT = Math.abs(effective.eut);
  const baseTicks = effective.durationTicks;
  const discount =
    getMachineEutMultiplier(effective, budgeted) *
    getHeatDiscountMultiplier(
      effective,
      budgeted,
      report.tier,
      getEffectiveVoltageOrdinal(effective, budgeted, report.tier),
    );

  const perfect = stats.perfectOverclockSteps;
  const imperfect = stats.overclockSteps - perfect;
  const kinds: string[] = [];
  if (perfect > 0) {
    kinds.push(`${perfect} perfect`);
  }
  if (imperfect > 0) {
    kinds.push(`${imperfect} imperfect`);
  }

  const rows: PowerLadderRow[] = [];
  if (Math.abs(discount - 1) > 1e-9) {
    rows.push({
      id: "discount",
      label: "Discount",
      recipe: "—",
      supplied: `${compact(discount * 100)}% power`,
      help: "This machine runs recipes at a share of their power. It is taken first, before parallels or overclocks.",
    });
  }
  rows.push({
    id: "parallels",
    label: "Parallels",
    recipe: "1",
    supplied: String(parallels),
    help: "Recipes running at once. Each one costs its own EU/t, and the supply pays for all of them before it buys any overclock. Parallels cost nothing extra per item.",
  });
  rows.push({
    id: "overclocks",
    label: "Overclocks",
    recipe: "—",
    supplied: kinds.length > 0 ? kinds.join(", ") : "none",
    help: "Every four times the draw the supply can cover buys one step. Imperfect: half the time for four times the power. Perfect: a quarter of the time for four times the power.",
  });
  rows.push({
    id: "time",
    label: "Time per run",
    recipe: ticks(baseTicks),
    supplied: ticks(stats.durationTicks),
    help: "How long one recipe takes. Under one tick the machine runs several recipes every tick instead.",
  });
  rows.push({
    id: "energy",
    label: "EU per run",
    recipe: compact(baseEuT * baseTicks),
    supplied: compact(Math.abs(stats.eut) * stats.durationTicks),
    help: "What one recipe costs in energy. Imperfect overclocks double it every step. Perfect overclocks and parallels keep it flat.",
  });
  rows.push({
    id: "draw",
    label: "Draw",
    recipe: `${compact(baseEuT)} EU/t`,
    supplied: `${compact(report.drawEuT)} EU/t`,
    help: "What the machine pulls from the hatches while it runs. Supply above this sits unused until the next boost.",
  });
  rows.push({
    id: "runs",
    label: "Runs per second",
    recipe: compact(20 / baseTicks),
    supplied: compact((parallels * 20) / stats.durationTicks),
    help: "How many recipes finish every second with everything the supply buys. Multiply by the recipe's outputs for what comes out.",
    emphasis: true,
  });

  // The wiki's advice: an imperfect step doubles the energy per run, so two
  // machines one step lower give the same output for half the power.
  const hint =
    imperfect > 0 && report.state === "ok"
      ? `Two of these at ${compact(budgetEuT / 4)} EU/t each: same output, half the power.`
      : undefined;

  const wins = listPowerWinsCached(recipe, node);
  const nextWin = nextPowerWin(wins, budgetEuT);
  const previousWin = previousPowerWin(wins, budgetEuT);
  const floor = previousWin?.euT ?? Math.min(budgetEuT, nextWin?.euT ?? budgetEuT);
  const progress =
    budgetEuT > 0 && nextWin && nextWin.euT > floor
      ? Math.max(0, Math.min(1, Math.log(budgetEuT / floor) / Math.log(nextWin.euT / floor)))
      : 1;

  return {
    budgetEuT,
    report,
    readAs: `${tier} × ${compact(amps)} A`,
    draw:
      parallels > 1
        ? `Uses ${compact(report.drawEuT)} EU/t (${compact(Math.abs(stats.eut))} × ${parallels})`
        : `Uses ${compact(report.drawEuT)} EU/t`,
    drawEuT: report.drawEuT,
    rows,
    hint,
    stall: describePowerStall(report),
    previousWin,
    nextWin,
    progress,
  };
}
