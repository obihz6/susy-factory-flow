import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe, getRecipeMachineConfigTierControls } from "@/lib/model/recipe-rules";
import { getMachineDurationMultiplier, getMachineEutMultiplier, getMachineStructuralParallels } from "@/lib/solver/machine-effects";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { getNodePowerReport } from "@/lib/solver/power-report";
import { isMultiblockRecipe } from "@/lib/solver/power";
import { prefersCuratedMachineMath } from "@/lib/solver/runtime-calculation";
import { normalizeHatchInput } from "@/lib/solver/hatch-input";

// MTEAdvDistillationTower#getMaxParallelRecipes/setupProcessingLogic and
// MTEMultiBlockBase#setProcessingLogicPower. Deliberately stale handler bakes
// and a default-handler runtime ladder reproduce the published-data path.
function recipe(map: string): Recipe {
  return {
    id: map, name: map, machineType: map, source: { recipeMap: map },
    minimumTier: "MV", eut: 120, durationTicks: 600,
    inputs: [{ kind: "fluid", id: "feed", amount: 1000 }],
    outputs: [{ kind: "fluid", id: "fraction", amount: 1000 }],
    machineHandlers: [{
      id: "dangote-distillus", label: "Dangote Distillus", machineType: "Dangote Distillus",
      kind: "multiblock", minimumTier: "IV", durationTicks: 100, eut: 18,
      machineConfigControls: ["machineParallel", "voltageParallel"].map((id) => ({
        id, label: id, minimumKey: "fixed-40", tiers: [{ key: "fixed-40", label: "40", parallelMultiplier: 40,
          resource: { kind: "item", id: "stale", amount: 1 } }],
      })),
    }],
    runtimeCalculation: { oracleEligible: true, sourceKind: "gregtech-overclock-calculator", status: "computed",
      variants: [{ id: "mv", label: "MV", overclockTier: "MV", eut: 120, durationTicks: 600, parallel: 1 }] },
  };
}
const node: FactoryNode = {
  id: "dangote", recipeId: "Distillery", machineHandlerId: "dangote-distillus",
  enabled: true, machineCount: 1, parallel: 1, position: { x: 0, y: 0 },
  overclockTier: "MV", hatchVoltageTier: "MV", hatchAmps: 1,
};

describe("Dangote Distillus source-verified modes", () => {
  it.each(["Distillery", "Distillation Tower"])("enables working hatch controls for %s and drops stale parallel controls", (map) => {
    const effective = applyMachineHandlerToRecipe(recipe(map), node);
    expect(isMultiblockRecipe(effective)).toBe(true);
    expect(prefersCuratedMachineMath(effective)).toBe(true);
    expect(getRecipeMachineConfigTierControls(effective, node)).toEqual([]);
    expect(effective.eut).toBe(120);
    expect(effective.durationTicks).toBe(600);
    expect(effective.minimumTier).toBe("MV");
  });

  it.each([['LV', 8], ['MV', 16], ['HV', 24], ['EV', 32], ['IV', 40], ['LuV', 48], ['ZPM', 56]])(
    "scales a 12-layer distillery at %s to %i structural parallels", (tier, parallels) => {
      const configured = { ...node, hatchVoltageTier: tier as FactoryNode["hatchVoltageTier"] };
      const effective = applyMachineHandlerToRecipe(recipe("Distillery"), configured);
      expect(getMachineStructuralParallels(effective, configured)).toBe(parallels);
      expect(getMachineDurationMultiplier(effective, configured)).toBe(0.5);
      expect(getMachineEutMultiplier(effective, configured)).toBe(0.15);
      const tower = applyMachineHandlerToRecipe(recipe("Distillation Tower"), configured);
      expect(getMachineStructuralParallels(tower, configured)).toBe(12);
      expect(getMachineDurationMultiplier(tower, configured)).toBe(1 / 3);
      expect(getMachineEutMultiplier(tower, configured)).toBe(1);
    },
  );

  it("spends real supplied power on parallels and counts stacked ordinary hatch voltages", () => {
    const distillery = recipe("Distillery");
    const single = getNodePowerReport(distillery, node);
    expect(single.parallels).toBe(7); // floor(128 / (120 * .15))
    expect(getOverclockedRecipeStats(distillery, node).durationTicks).toBe(300);
    const pair = { ...node, hatchAmps: 4 }; // Two ordinary MV hatches: 256 summed V -> HV ordinal.
    expect(getNodePowerReport(distillery, pair).parallels).toBe(24);
    expect(getOverclockedRecipeStats(distillery, pair).durationTicks).toBe(300);
    const legacy = { ...node, hatchVoltageTier: undefined, hatchAmps: undefined, overclockTier: "MV" as const, energyHatches: 2 };
    expect(getNodePowerReport(distillery, normalizeHatchInput(distillery, legacy, true)).parallels).toBe(24);
  });

  it("keeps tower mode at twelve parallels and spends spare amps on normal overclocks", () => {
    const tower = recipe("Distillation Tower");
    expect(getNodePowerReport(tower, node).parallels).toBe(1);
    expect(getOverclockedRecipeStats(tower, node).durationTicks).toBe(200);
    const supplied = { ...node, hatchAmps: 64 };
    expect(getNodePowerReport(tower, supplied).parallels).toBe(12);
    expect(getOverclockedRecipeStats(tower, supplied).durationTicks).toBe(100);
  });
});
