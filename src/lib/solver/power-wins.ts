import { getVoltageTierMaxEuT } from "@/lib/model/tiers";
import { isFusionRecipe } from "@/lib/machines/fusion";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { getNodePowerReport, type NodePowerReport } from "./power-report";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import { getMachineStructuralParallels } from "./machine-effects";

/**
 * One budget worth stepping to: the smallest EU/t at which the build gains
 * something over the budget just under it - it starts, takes another
 * overclock step, or runs more parallels. Everything between two wins is
 * wasted supply, so these are the only stops a supply dial needs.
 */
export interface PowerWin {
  euT: number;
  /** What the budget buys, for the chip's "next" line: "3 overclocks", "12 parallels", "runs". */
  gain: string;
  overclockSteps: number;
  parallels: number;
  runs: boolean;
}

export type PowerWinNode = Pick<
  FactoryNode,
  "overclockTier" | "coilTier" | "machineHandlerId" | "machineConfigTiers"
> &
  Partial<
    Pick<
      FactoryNode,
      "energyHatches" | "energyHatchType" | "powerEuT" | "hatchVoltageTier" | "hatchAmps" | "powerInputMode"
    >
  >;

/** The largest budget worth scanning: past MAX voltage there is no hatch. */
const CEILING = getVoltageTierMaxEuT("MAX") * 16_777_216;

function outcome(recipe: Recipe, node: PowerWinNode, euT: number): NodePowerReport {
  return getNodePowerReport(recipe, powerNodeAtBudget(node, euT));
}

function same(a: NodePowerReport, b: NodePowerReport): boolean {
  if (a.state !== "ok" && b.state !== "ok") return true;
  return (
    (a.state === "ok") === (b.state === "ok") &&
    a.overclockSteps === b.overclockSteps &&
    a.parallels === b.parallels
  );
}

function describe(report: NodePowerReport): string {
  if (report.state !== "ok") {
    return "does not run";
  }
  const parts: string[] = [];
  if (report.overclockSteps > 0) {
    parts.push(`${report.overclockSteps} overclock${report.overclockSteps === 1 ? "" : "s"}`);
  }
  if (report.parallels > 1) {
    parts.push(`${report.parallels} parallels`);
  }
  return parts.length > 0 ? parts.join(", ") : "runs";
}

/**
 * Every win between the recipe's own draw and the top of the hatch ladder,
 * ascending. Found by walking a fine geometric grid of budgets, watching
 * for the report to change, and bisecting each change down to the exact
 * EU/t it happens at. Cheap enough for a hover: the report is a handful of
 * arithmetic per sample.
 */
export function listPowerWins(recipe: Recipe, node: PowerWinNode): PowerWin[] {
  if (isFusionRecipe(recipe)) return [];
  const floor = 1;
  const wins: PowerWin[] = [];
  const stepRatio = 2 ** 0.25;
  let previousEuT = floor;
  let previous = outcome(recipe, node, previousEuT);
  if (previous.state === "ok") {
    wins.push(toWin(previousEuT, previous));
  }
  for (let euT = floor * stepRatio; euT <= CEILING; euT *= stepRatio) {
    const current = outcome(recipe, node, euT);
    if (!same(previous, current)) {
      // The change lives somewhere in (previousEuT, euT]: bisect to it.
      let low = previousEuT;
      let high = euT;
      for (let i = 0; i < 60 && high - low > Math.max(1e-6, Number.EPSILON * high * 2); i += 1) {
        const mid = (low + high) / 2;
        if (same(previous, outcome(recipe, node, mid))) {
          low = mid;
        } else {
          high = mid;
        }
      }
      const exact = snapToWholeEuT(high, recipe, node, previous);
      const report = outcome(recipe, node, exact);
      if (report.state === "ok") wins.push(toWin(exact, report));
    }
    previous = current;
    previousEuT = euT;
  }
  return wins;
}

/** A win lands on a whole EU/t: the first whole number that still wins. */
function snapToWholeEuT(
  euT: number,
  recipe: Recipe,
  node: PowerWinNode,
  before: NodePowerReport,
): number {
  // The bisection stops a hair above the threshold; the whole number just
  // under it is the win when it already buys the change, else the next one.
  const whole = Math.floor(euT);
  return same(before, outcome(recipe, node, whole)) ? whole + 1 : whole;
}

function toWin(euT: number, report: NodePowerReport): PowerWin {
  return {
    euT,
    gain: describe(report),
    overclockSteps: report.overclockSteps,
    parallels: report.parallels,
    runs: report.state === "ok",
  };
}

/**
 * The scan above costs ~25 ms and its answer does not depend on the budget
 * being set - only on the recipe and the card's other knobs - so every
 * caller that walks or reads the ladder goes through this cache. Keyed by
 * the recipe's identity and figures rather than the object: a card hands
 * over a freshly derived recipe object on every write. Bounded, so a long
 * session never grows it past a few hundred ladders.
 */
const winsCache = new Map<string, PowerWin[]>();
const WINS_CACHE_LIMIT = 400;

export function listPowerWinsCached(recipe: Recipe, node: PowerWinNode): PowerWin[] {
  const key = JSON.stringify([
    recipe.id,
    recipe.machineType,
    recipe.durationTicks,
    recipe.eut,
    recipe.minimumTier,
    node.machineHandlerId ?? "",
    node.coilTier ?? "",
    node.machineConfigTiers ?? null,
    node.hatchVoltageTier ?? "",
    node.powerInputMode ?? "amps",
    node.energyHatchType ?? "",
    node.energyHatches ?? 1,
  ]);
  const hit = winsCache.get(key);
  if (hit) {
    return hit;
  }
  const wins = listPowerWins(recipe, node);
  if (winsCache.size >= WINS_CACHE_LIMIT) {
    const oldest = winsCache.keys().next().value;
    if (oldest !== undefined) {
      winsCache.delete(oldest);
    }
  }
  winsCache.set(key, wins);
  return wins;
}

/** The first win strictly above this budget, if any. */
export function nextPowerWin(wins: PowerWin[], euT: number): PowerWin | undefined {
  return wins.find((win) => win.euT > euT * (1 + 1e-9));
}

/** Target full parallel capacity before advancing to individual overclock gains. */
export function fullParallelPowerWin(recipe: Recipe, node: FactoryNode, wins: PowerWin[]): PowerWin | undefined {
  const effective = applyMachineHandlerToRecipe(recipe, node);
  const current = getNodePowerReport(recipe, node);
  const capacity = getMachineStructuralParallels(effective, node);
  if (capacity <= 1 || !Number.isFinite(capacity) || (current.state === "ok" && current.parallels >= capacity)) return undefined;
  const isFull = (euT: number) => {
    const candidate = powerNodeAtBudget(node, euT);
    const report = getNodePowerReport(recipe, candidate);
    return report.state === "ok" && report.parallels >= getMachineStructuralParallels(effective, candidate);
  };
  const upper = wins.find(win => win.euT > current.poolEuT && isFull(win.euT));
  if (!upper) return undefined;
  // The geometric win scan may skip individual parallel steps. Refine the
  // saturation point itself rather than using a later sampled overclock.
  let low = current.poolEuT;
  let high = upper.euT;
  for (let i = 0; i < 60 && high - low > Math.max(1e-6, Number.EPSILON * high * 2); i++) {
    const mid = (low + high) / 2;
    if (isFull(mid)) high = mid;
    else low = mid;
  }
  const whole = Math.floor(high);
  const euT = isFull(whole) ? whole : whole + 1;
  return toWin(euT, outcome(recipe, node, euT));
}

/** The last win strictly below this budget, if any. */
export function previousPowerWin(wins: PowerWin[], euT: number): PowerWin | undefined {
  let found: PowerWin | undefined;
  for (const win of wins) {
    if (win.euT < euT * (1 - 1e-9)) {
      found = win;
    }
  }
  return found;
}

/** Change supply without changing the average hatch voltage. */
export function powerNodeAtBudget<T extends PowerWinNode>(node: T, euT: number): T {
  return {
    ...node,
    powerEuT: euT,
    ...(node.hatchVoltageTier
      ? {
          hatchAmps: euT / getVoltageTierMaxEuT(node.hatchVoltageTier),
        }
      : {}),
  };
}
