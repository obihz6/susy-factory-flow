import { describe, expect, it } from "vitest";
import type { FactoryProject, Recipe } from "./types";
import { normalizeFullFarms } from "./full-farms";
import { cropsNhFarmEut, cropsNhHarvesterFromTiers, cropsNhHarvesterMachineCount } from "./passive-production";

const recipe = { id: "crop", name: "Crop Farm", machineType: "Crop Farm", minimumTier: "NONE", durationTicks: 256, eut: 0, inputs: [], outputs: [], metadata: { cropsNh: {
  tier: 4, growthPoints: 1200, dropChance: 0.8, growthCycleTicks: 256, growthMultiplier: 1,
  drops: [{ id: "berry", stackSize: 2, weight: 10000 }],
} } } as Recipe;
function project(fullCount?: number): FactoryProject {
  return { schemaVersion: 1, id: "test", name: "Test", edges: [], fuelProfiles: [], recipes: [recipe], nodes: [{ id: "farm", parallel: 1, enabled: true, overclockTier: "NONE", position: { x: 0, y: 0 }, recipeId: "crop", machineCount: 730,
    cropFullFarmCount: fullCount, machineHandlerId: "crop-industrial-farm",
    machineConfigTiers: { cropSeedBedTier: "5" },
  }] } as FactoryProject;
}
describe("full farm planting", () => {
  it("fills whole farms and preserves their count across tier changes", () => {
    const initial = normalizeFullFarms(project(2));
    expect(initial.nodes[0]!.machineCount).toBe(1458);
    initial.nodes[0]!.machineConfigTiers = { cropSeedBedTier: "6" };
    expect(normalizeFullFarms(initial).nodes[0]!.machineCount).toBe(1922);
  });
  it("preserves partial planting and legacy saves when unchecked", () => {
    const partial = project();
    expect(normalizeFullFarms(partial)).toBe(partial);
    const filled = normalizeFullFarms(project(2));
    filled.nodes[0]!.cropFullFarmCount = undefined;
    expect(normalizeFullFarms(filled).nodes[0]!.machineCount).toBe(1458);
  });
  it("does not apply farm capacity to Crop Managers", () => {
    const manager = project(2);
    manager.nodes[0]!.machineHandlerId = "crop-manager";
    expect(normalizeFullFarms(manager)).toBe(manager);
  });
  it("bills the same whole-farm running power for partial and full planting", () => {
    const setup = cropsNhHarvesterFromTiers({ cropSeedBedTier: "5" }, "crop-industrial-farm");
    const power = (seeds: number) => cropsNhFarmEut(setup) * cropsNhHarvesterMachineCount(setup, seeds);
    expect(power(730)).toBe(power(1458));
    expect(power(730)).toBe(2 * power(729));
  });
});
