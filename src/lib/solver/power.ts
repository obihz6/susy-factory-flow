import { getEnergyHatchType } from "@/lib/machines/energy-hatches";
import { getMachineBehaviour } from "@/lib/machines/machine-table";
import { getFusionMachine, getFusionStats } from "@/lib/machines/fusion";
import {
  GT_VOLTAGE_TIERS,
  getRecipeMinimumVoltageTier,
  getRunVoltageTier,
  getVoltageTierForEuT,
  getVoltageTierIndex,
  getVoltageTierMaxEuT,
  getVoltageTierWithinEuT,
  resolveVoltageTier,
} from "@/lib/model/tiers";
import type { FactoryNode, MachineTier, Recipe } from "@/lib/model/types";

type VoltageTier = Exclude<MachineTier, "DEMO">;
type PowerRecipeInput = Partial<
  Pick<Recipe, "machineType" | "machineHandlers" | "machineProfile" | "eut" | "minimumTier">
>;
type PowerNodeInput = Partial<
  Pick<
    FactoryNode,
    | "energyHatches"
    | "energyHatchType"
    | "powerEuT"
    | "hatchVoltageTier"
    | "hatchAmps"
    | "powerInputMode"
    | "machineConfigTiers"
  >
>;

/** The pair's derived supply, with a legacy EU/t fallback for unmigrated nodes. */
export function getNodePowerBudget(
  recipe: PowerRecipeInput,
  node: PowerNodeInput,
): number | undefined {
  const fusion = getFusionStats(recipe);
  if (fusion) return fusion.poolEuT;
  if (!isMultiblockRecipe(recipe)) {
    return undefined;
  }
  // Zero is a real answer - no supply at all, which the report calls
  // underpowered - so only an absent or broken value falls back to the pair.
  if (
    node.hatchVoltageTier !== undefined &&
    node.hatchAmps !== undefined &&
    Number.isFinite(node.hatchAmps) &&
    node.hatchAmps >= 0
  ) {
    return getVoltageTierMaxEuT(node.hatchVoltageTier) * node.hatchAmps;
  }
  const budget = node.powerEuT;
  return budget !== undefined && Number.isFinite(budget) && budget >= 0 ? budget : undefined;
}

/**
 * Whether the machine actually running this recipe is a multiblock, which is
 * what decides whether energy hatches exist at all.
 *
 * A handler exported with the recipe knows its own kind. When the recipe
 * carries no handlers, `getRecipeMachineHandlers` invents one stamped
 * `single` as a placeholder - not evidence - so the curated table answers
 * instead, whose entries are multiblocks unless marked `kind: "single"`.
 */
export function isMultiblockRecipe(recipe: PowerRecipeInput): boolean {
  if (getFusionMachine(recipe.machineType)) return true;
  if (recipe.machineProfile?.kind === "multiblock") return true;
  if ((recipe.machineHandlers?.length ?? 0) > 0) return false;
  const behaviour = getMachineBehaviour(recipe.machineType);
  return behaviour !== undefined && behaviour.kind !== "single";
}

/** Raw EU/t assumes a suitable voltage, but never adds energy to the pool. */
function rawInputTier(recipe: PowerRecipeInput, node: PowerNodeInput): VoltageTier {
  const minimum = getRecipeMinimumVoltageTier({
    eut: recipe.eut ?? 0,
    minimumTier: recipe.minimumTier ?? "ULV",
  });
  const supplied = getVoltageTierWithinEuT(getNodePowerBudget(recipe, node) ?? 0);
  return getVoltageTierIndex(minimum) > getVoltageTierIndex(supplied) ? minimum : supplied;
}

/**
 * The tier this node runs at. A singleblock is floored at the recipe's
 * minimum - there is no lower machine to build, and legacy plans store
 * below-minimum tiers that always meant "the minimum". A multiblock honours
 * the pick as made: hatches below the recipe's tier are a real build, and the
 * power report is what says whether it starts.
 */
export function getNodeRunTier(
  recipe: PowerRecipeInput & Pick<Recipe, "eut" | "minimumTier">,
  node: PowerNodeInput & Partial<Pick<FactoryNode, "overclockTier">>,
): VoltageTier {
  const fusion = getFusionMachine(recipe.machineType);
  if (fusion) return fusion.tier;
  if (!isMultiblockRecipe(recipe)) {
    return getRunVoltageTier(recipe, node.overclockTier);
  }
  const limit = getMachineBehaviour(recipe.machineType)?.inputVoltageTierLimit?.(node.machineConfigTiers ?? {}) ?? Infinity;
  const limited = (tier: VoltageTier): VoltageTier =>
    GT_VOLTAGE_TIERS[Math.min(getVoltageTierIndex(tier), limit)]?.tier ?? tier;
  if (node.powerInputMode === "eut") return limited(rawInputTier(recipe, node));
  if (node.hatchVoltageTier !== undefined) return limited(node.hatchVoltageTier);
  // Legacy nodes outside the load funnel retain their historical interpretation.
  // A typed budget names its own hatch tier: the highest voltage that fits
  // inside it. The tier-skip rule and the parallel ordinal read that tier.
  const budget = getNodePowerBudget(recipe, node);
  if (budget !== undefined) {
    return limited(getVoltageTierWithinEuT(budget));
  }
  return limited(resolveVoltageTier(node.overclockTier, getRecipeMinimumVoltageTier(recipe)));
}

/**
 * The node's hatch count, defaulting to one and meaningless on singleblocks.
 * An exotic hatch family (multi-amp, laser) is game-limited to exactly ONE
 * hatch, so a count stored while regular hatches were selected clamps away.
 */
export function getNodeEnergyHatches(recipe: PowerRecipeInput, node: PowerNodeInput): number {
  if (!isMultiblockRecipe(recipe)) {
    return 1;
  }
  if (getEnergyHatchType(node.energyHatchType).exotic) {
    return 1;
  }
  const hatches = node.energyHatches ?? 1;
  return Number.isFinite(hatches) ? Math.max(1, Math.floor(hatches)) : 1;
}

/**
 * Working amps for a regular hatch count, from `setProcessingLogicPower`:
 * exactly one standard hatch is clamped to 1 amp; two or more work at 2 amps
 * each.
 */
export function getHatchAmps(hatches: number): number {
  return hatches <= 1 ? 1 : 2 * hatches;
}

/**
 * The amps the machine's power maths run on: hatch amps for a multiblock, the
 * machine's own amperage for a singleblock (1 for nearly everything, 3 for
 * the arc furnaces). An exotic hatch carries its whole rating - one 64 A
 * hatch is 64 amps, no clamp - which is `getMaxWorkingInputAmpsMulti`.
 */
export function getNodePowerAmps(recipe: PowerRecipeInput, node: PowerNodeInput): number {
  const fusion = getFusionMachine(recipe.machineType);
  if (fusion) return fusion.compact ? 64 * fusion.mark : 1;
  if (isMultiblockRecipe(recipe)) {
    if (node.powerInputMode === "eut")
      return (
        (getNodePowerBudget(recipe, node) ?? 0) / getVoltageTierMaxEuT(rawInputTier(recipe, node))
      );
    if (node.hatchVoltageTier !== undefined && node.hatchAmps !== undefined) return node.hatchAmps;
    // A typed budget is the whole supply: whatever is left over the tier's
    // voltage is amps, fractional or not - the game multiplies the two back
    // together before it counts a single overclock.
    const budget = getNodePowerBudget(recipe, node);
    if (budget !== undefined) {
      return budget / getVoltageTierMaxEuT(getVoltageTierWithinEuT(budget));
    }
    const hatchType = getEnergyHatchType(node.energyHatchType);
    if (hatchType.exotic) {
      return hatchType.amps;
    }
    const hatches = getNodeEnergyHatches(recipe, node);
    // Mega-style power draws every hatch's whole 2 amps - a lone hatch
    // included, where the base rule clamps it to 1.
    if (getMachineBehaviour(recipe.machineType)?.fullPowerPool) {
      return 2 * hatches;
    }
    return getHatchAmps(hatches);
  }
  return getMachineBehaviour(recipe.machineType)?.amperage ?? 1;
}

/** Total EU/t the build can drink: tier voltage times its working amps. */
export function getPowerPoolEuT(
  recipe: PowerRecipeInput,
  node: PowerNodeInput,
  tier: VoltageTier,
): number {
  return getVoltageTierMaxEuT(tier) * getNodePowerAmps(recipe, node);
}

/**
 * The voltage-tier ordinal the machine's own formulas see, which is NOT
 * simply the hatch tier: `GTUtility.getTier(getMaxInputVoltage())` reads the
 * SUM of hatch voltages, so two MV hatches (256 V) already count as HV for
 * "parallels per voltage tier" scaling and for the blast furnaces' 100 K per
 * tier heat bonus. One hatch leaves the ordinal at its own tier.
 */
export function getEffectiveVoltageOrdinal(
  recipe: PowerRecipeInput,
  node: PowerNodeInput,
  tier: VoltageTier,
): number {
  const fullPowerPool = getMachineBehaviour(recipe.machineType)?.fullPowerPool === true;
  const budget = getNodePowerBudget(recipe, node);
  if (budget !== undefined) {
    // A typed budget is read as REGULAR hatches of its tier: two amps each
    // once there is more than one, so the summed voltage is half the
    // budget, and never under the tier's own voltage (one hatch, one amp).
    // Mega-style machines count the amps themselves, so the budget stands.
    const summedVoltage = fullPowerPool ? budget : Math.max(getVoltageTierMaxEuT(tier), budget / 2);
    return getVoltageTierIndex(getVoltageTierForEuT(summedVoltage));
  }
  const hatches = getNodeEnergyHatches(recipe, node);
  // Mega-style machines read `getMaxInputEu()`, which counts each regular
  // hatch's full 2 amps; everything else sums hatch voltages alone.
  const perHatch = fullPowerPool ? 2 : 1;
  const summedVoltage = getVoltageTierMaxEuT(tier) * hatches * perHatch;
  if (!Number.isFinite(summedVoltage)) {
    return getVoltageTierIndex(tier);
  }
  return getVoltageTierIndex(getVoltageTierForEuT(summedVoltage));
}
