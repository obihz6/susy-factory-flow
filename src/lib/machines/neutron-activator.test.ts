import { describe, expect, it } from "vitest";
import {
  getAdjacentMachineConfigTier,
  getRecipeMachineConfigTierControls,
} from "@/lib/model/recipe-rules";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "@/lib/model/types";
import { buildMachineContext } from "@/lib/solver/machine-effects";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { calculateThroughput } from "@/lib/solver/throughput";

const recipe: Recipe = {
  id: "neutron",
  name: "Neutron test",
  machineType: "Neutron Activator",
  minimumTier: "LV",
  durationTicks: 400,
  eut: 0,
  inputs: [{ kind: "item", id: "feed", amount: 2 }],
  outputs: [{ kind: "item", id: "product", amount: 3 }],
};
const node = (height: string) => ({
  id: "activator",
  recipeId: recipe.id,
  machineCount: 1,
  parallel: 1,
  overclockTier: "LV",
  enabled: true,
  position: { x: 0, y: 0 },
  machineConfigTiers: { speedingPipeCasing: height, unrelated: "keep" },
});

describe("Neutron Activator height", () => {
  it.each(["4", "12", "13", "32", "77", "256", "10000"])(
    "resolves arbitrary height %s without a ladder cap",
    (height) => {
      const control = getRecipeMachineConfigTierControls(recipe, node(height))[0]!;
      expect(control.current.key).toBe(height);
      expect(control.numeric).toEqual({ min: 4 });
      expect(buildMachineContext(recipe, node(height)).value("speedingPipeCasing")).toBe(
        Number(height),
      );
      expect(getAdjacentMachineConfigTier(control, 1)).toBe(String(Number(height) + 1));
    },
  );

  it.each(["", "-5", "NaN", "Infinity"])(
    "keeps invalid height %s at the structural minimum",
    (height) => {
      expect(getRecipeMachineConfigTierControls(recipe, node(height))[0]!.current.key).toBe("4");
    },
  );

  // Independently recorded values for a 400t recipe using MTENeutronActivator
  // and ParallelHelper's custom supplier path (GT5U 8e23867).
  it.each([
    [4, 400],
    [5, 360],
    [12, 173],
    [32, 21],
    [60, 2],
    [64, 1],
    [100, 1 / 61],
  ])("runs height %i at %s equivalent ticks", (height, durationTicks) => {
    const result = getOverclockedRecipeStats(recipe, node(String(height)));
    expect(result.durationTicks).toBe(durationTicks);
    expect(result.eut).toBe(0);
    expect(result.overclockSteps).toBe(0);
    expect(
      getOverclockedRecipeStats(recipe, { ...node(String(height)), overclockTier: "MAX" })
        .durationTicks,
    ).toBe(durationTicks);
  });

  it("uses Java float precision at an integer boundary", () => {
    // 100 * 0.9f^2 is just below 81, not the 81.00000000000001 obtained
    // from repeated decimal JS operations that could ceil to 82.
    expect(
      getOverclockedRecipeStats({ ...recipe, durationTicks: 100 }, node("6")).durationTicks,
    ).toBe(81);
  });

  it("saturates at the game's parallel integer limit instead of becoming slow on overflow", () => {
    expect(getOverclockedRecipeStats(recipe, node("10000")).durationTicks).toBe(1 / 2_147_483_647);
  });

  it("keeps custom height through JSON import and load normalization, with matching material rates", () => {
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "neutron-height",
      name: "Neutron height",
      recipes: [recipe],
      nodes: [node("100")],
      edges: [],
      fuelProfiles: [],
      setupRules: { freeInputs: true, freeOutputs: true },
    };
    const restored = normalizeLoadedProject(
      factoryProjectSchema.parse(JSON.parse(JSON.stringify(project))),
    );
    expect(restored.nodes[0]!.machineConfigTiers).toEqual(node("100").machineConfigTiers);
    const result = calculateThroughput(restored).nodes.activator!;
    expect(result.operationRatePerSecond).toBe(1220);
    expect(result.inputs["item:feed"]!.amountPerSecond).toBe(2440);
    expect(result.outputs["item:product"]!.amountPerSecond).toBe(3660);
  });
});
