import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import {
  cropsNhCropsPerMachine,
  cropsNhEnvironmentFromTiers,
  cropsNhEutPerCrop,
  cropsNhFarmEut,
  cropsNhHarvesterEnvironment,
  cropsNhHarvesterMachineCount,
  cropsNhHarvesterFromTiers,
  cropsNhSquarePerTier,
  cropsNhUnitSlotsUsed,
  cropsNhUpgradeSlots,
  enrichPassiveProductionRecipe,
} from "@/lib/model/passive-production";
import { getOverclockedRecipeStats } from "./overclock";
import {
  getMachineDurationMultiplier,
  getMachineEutMultiplier,
  getMachineOutputMultiplier,
  getMachineParallelMultiplier,
} from "./machine-effects";

describe("voltage-scaled parallels", () => {
  const recipeWithControl = (tier: Record<string, number>): Recipe => ({
    id: "test",
    name: "test",
    // Deliberately a machine the curated table does not cover, so these cases
    // exercise the dataset-driven fallback rather than a table entry.
    machineType: "Test Voltage Parallel Multiblock",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 8,
    inputs: [],
    outputs: [{ kind: "item", id: "fish", amount: 1 }],
    machineConfigControls: [
      {
        id: "voltageParallel",
        label: "Parallels per Tier",
        minimumKey: "only",
        defaultKey: "only",
        tiers: [
          {
            key: "only",
            label: "only",
            ...tier,
            resource: { kind: "item", id: "x", amount: 1 },
          },
        ],
      },
    ],
  });

  it("scales linearly with the run tier", () => {
    const recipe = recipeWithControl({ parallelPerVoltageTier: 2 });
    expect(getMachineParallelMultiplier(recipe, { overclockTier: "LV" })).toBe(2);
    expect(getMachineParallelMultiplier(recipe, { overclockTier: "EV" })).toBe(8);
  });

  it("supports affine base with floor (Zhuhai and Density^2 forms)", () => {
    const zhuhai = recipeWithControl({ parallelPerVoltageTier: 2, parallelVoltageBase: 2 });
    expect(getMachineParallelMultiplier(zhuhai, { overclockTier: "LV" })).toBe(4);
    expect(getMachineParallelMultiplier(zhuhai, { overclockTier: "UV" })).toBe(18);

    const density = recipeWithControl({ parallelPerVoltageTier: 0.5, parallelVoltageBase: 1 });
    expect(getMachineParallelMultiplier(density, { overclockTier: "LV" })).toBe(1);
    expect(getMachineParallelMultiplier(density, { overclockTier: "MV" })).toBe(2);
    expect(getMachineParallelMultiplier(density, { overclockTier: "HV" })).toBe(2);
    expect(getMachineParallelMultiplier(density, { overclockTier: "EV" })).toBe(3);
  });
});

describe("CropsNH analytic crop math", () => {
  // Argentia in 2.9.0-beta-2: tier 7, 1400 growth points, dropChance 0.6983373.
  const argentia = (): Recipe =>
    enrichPassiveProductionRecipe({
      id: "cropsnh-crop-argentia",
      name: "Crop Farm: Argentia",
      machineType: "Crop Farm",
      minimumTier: "NONE",
      durationTicks: 3328,
      eut: 0,
      inputs: [],
      outputs: [
        { kind: "item", id: "cropsnh:materialleaf@26", amount: 2.29, displayName: "Argentia Leaf" },
      ],
      metadata: {
        cropsNh: {
          tier: 7,
          growthPoints: 1400,
          dropChance: 0.6983373,
          growthCycleTicks: 256,
          growthMultiplier: 1,
          drops: [{ id: "cropsnh:materialleaf@26", stackSize: 1, weight: 10000 }],
        },
      },
      source: { recipeMap: "Crop Farm" },
    });

  it("adds stat and environment controls with ideal defaults", () => {
    const recipe = argentia();
    expect(recipe.machineConfigControls?.map((control) => control.id)).toEqual([
      "cropGrowthStat",
      "cropGainStat",
      "cropWater",
      "cropFertilizer",
      "cropSky",
      "cropBiome",
    ]);
    expect(
      recipe.machineConfigControls?.every((control) => control.tiers.length > 0),
    ).toBe(true);
  });

  it("matches the in-game growth formula at the reference environment", () => {
    const recipe = argentia();
    // score 55 -> supply 275 vs demand 70; rate = trunc(37 * 305 / 100) = 112;
    // ceil(1400 / 112) = 13 cycles of 256 ticks -> duration 1 at defaults.
    // Output is the default LV Crop Manager's 1 + 0.05 harvest rounds - the
    // by-hand rung is gone, so a bare card is an LV-managed one.
    expect(getMachineDurationMultiplier(recipe, { machineConfigTiers: {} })).toBe(1);
    expect(
      getMachineOutputMultiplier(recipe, { machineConfigTiers: {} }, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(1.05, 10);
  });

  it("slows down at low growth stats using integer cycle math", () => {
    const recipe = argentia();
    const node = { machineConfigTiers: { cropGrowthStat: "1" } };
    // Growth 1: rate = trunc(7 * 305 / 100) = 21; ceil(1400 / 21) = 67 cycles.
    expect(getMachineDurationMultiplier(recipe, node)).toBeCloseTo(67 / 13, 10);
  });

  it("scales yield by 1.03^gain drop rounds plus the bonus roll", () => {
    const recipe = argentia();
    const node = { machineConfigTiers: { cropGainStat: "1" } };
    // The default LV manager's 1.05 harvest rounds ride on top of the crop's
    // own gain curve.
    const expected = ((1.03 ** (1 - 31) * (1 + 0.02)) / (1 + 0.32)) * 1.05;
    expect(
      getMachineOutputMultiplier(recipe, node, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(expected, 10);
  });

  it("produces nothing when nutrient supply is 25+ under demand", () => {
    const recipe = argentia();
    const node = {
      machineConfigTiers: {
        cropWater: "0",
        cropFertilizer: "0",
        cropSky: "no",
        cropBiome: "none",
      },
    };
    // score 5 -> supply 25 vs demand 70: penalty 180% kills growth entirely.
    // (Empty water and fertilizer are worth +0, not +1: floor((0 + 9) / 10) = 0.)
    expect(
      getMachineOutputMultiplier(recipe, node, recipe.outputs[0]!, "LV"),
    ).toBe(0);
    expect(getMachineDurationMultiplier(recipe, node)).toBe(1);
  });
});

describe("passive production machine effects", () => {
  it("applies IC2 crop stat presets as generic config multipliers", () => {
    const recipe = enrichPassiveProductionRecipe(testCropRecipe());
    const lowStatsNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { cropStats: "1-1-1" },
    };
    const gainNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { cropStats: "23-31-0" },
    };

    expect(getMachineDurationMultiplier(recipe, lowStatsNode)).toBeCloseTo(3.102);
    expect(getMachineOutputMultiplier(recipe, lowStatsNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      0.866,
    );
    expect(getMachineDurationMultiplier(recipe, gainNode)).toBe(1);
    expect(getMachineOutputMultiplier(recipe, gainNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      2.741,
    );
  });

  it("applies bee frame output through the Forestry production formula", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const emptyNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: {},
    };
    const provenFramesNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: {
        beeFrameSlot1: "forestry:proven",
        beeFrameSlot2: "forestry:proven",
        beeFrameSlot3: "forestry:proven",
      },
    };

    expect(getMachineOutputMultiplier(recipe, emptyNode, recipe.outputs[0]!, "LV")).toBe(1);
    expect(
      getMachineOutputMultiplier(recipe, provenFramesNode, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(Math.pow(31, 0.52));
  });

  it("applies the speed gene as the getFinalChance speed^0.37 factor", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const blindingNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { beeSpeedGene: "blinding" },
    };
    const slowestNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { beeSpeedGene: "slowest" },
    };

    expect(
      getMachineOutputMultiplier(recipe, blindingNode, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(Math.pow(2, 0.37), 5);
    expect(
      getMachineOutputMultiplier(recipe, slowestNode, recipe.outputs[0]!, "LV"),
    ).toBeCloseTo(Math.pow(0.3, 0.37), 5);
    expect(getMachineDurationMultiplier(recipe, blindingNode)).toBe(1);
  });

  it("stacks the speed gene with housing production terms", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId"> = {
      machineConfigTiers: { beeSpeedGene: "blinding" },
      machineHandlerId: "alveary",
    };
    const alvearyRecipe = applyMachineHandlerToRecipe(recipe, node);

    expect(getMachineOutputMultiplier(alvearyRecipe, node, recipe.outputs[0]!, "LV")).toBeCloseTo(
      Math.pow(2, 0.37) * Math.pow(10, 0.52),
      5,
    );
  });

  it("applies bee climate requirements to specialty outputs", () => {
    const recipe = enrichPassiveProductionRecipe({
      ...testBeeRecipe(),
      outputs: [
        {
          kind: "item",
          id: "Forestry:beeCombs@0",
          amount: 1,
          displayName: "Honey Comb",
          tooltip: ["Product chance: 30%"],
        },
        {
          kind: "item",
          id: "GTPlusPlus:hydraComb",
          amount: 1,
          displayName: "Hydra Comb",
          tooltip: ["Specialty chance: 6%", "Needs preferred climate"],
        },
      ],
    });
    const toleratedNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { beeEnvironment: "tolerated" },
    };
    const wrongNode: Pick<FactoryNode, "machineConfigTiers" | "coilTier"> = {
      machineConfigTiers: { beeEnvironment: "wrong" },
    };

    expect(getMachineOutputMultiplier(recipe, toleratedNode, recipe.outputs[0]!, "LV")).toBeCloseTo(
      1,
    );
    expect(getMachineOutputMultiplier(recipe, toleratedNode, recipe.outputs[1]!, "LV")).toBe(0);
    expect(getMachineOutputMultiplier(recipe, wrongNode, recipe.outputs[0]!, "LV")).toBe(0);
  });

  it("applies bee machine handler production terms", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId"> = {
      machineConfigTiers: {},
      machineHandlerId: "alveary",
    };
    const alvearyRecipe = applyMachineHandlerToRecipe(recipe, node);

    expect(getMachineOutputMultiplier(alvearyRecipe, node, recipe.outputs[0]!, "LV")).toBeCloseTo(
      Math.pow(10, 0.52),
    );
  });

  it("combines valid Industrial Apiary speed and production upgrades without voltage overclocking", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<
      FactoryNode,
      "machineConfigTiers" | "machineHandlerId" | "coilTier" | "overclockTier"
    > = {
      machineConfigTiers: { beeIndustrialSpeed: "speed-4", beeIndustrialProduction: "4" },
      machineHandlerId: "industrial-apiary",
      overclockTier: "HV",
    };
    const industrialRecipe = applyMachineHandlerToRecipe(recipe, node);
    const stats = getOverclockedRecipeStats(industrialRecipe, node);

    expect(industrialRecipe.machineConfigControls?.map((control) => control.id)).toEqual([
      "beeSpeedGene",
      "beeIndustrialSpeed",
      "beeIndustrialProduction",
      "beeEnvironment",
    ]);
    expect(getMachineDurationMultiplier(industrialRecipe, node)).toBeCloseTo(1 / 16);
    expect(stats.tier).toBe("MV");
    expect(stats.overclockSteps).toBe(0);
    expect(stats.durationTicks).toBeCloseTo(550 / 16);
    expect(stats.eut).toBeCloseTo((37 + 2048) * 1.4 ** 4);
    expect(getMachineEutMultiplier(industrialRecipe, node)).toBeCloseTo(
      ((37 + 2048) / 37) * 1.4 ** 4,
    );
    expect(
      getMachineOutputMultiplier(industrialRecipe, node, recipe.outputs[0]!, "MV"),
    ).toBeCloseTo(Math.pow((4 * 1.2 ** 4 + 8) / 0.1, 0.52));
  });

  it("does not combine Upgraded Acceleration x256 with production upgrades", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<FactoryNode, "machineConfigTiers" | "machineHandlerId" | "coilTier"> = {
      machineConfigTiers: { beeIndustrialSpeed: "speed-8-upgraded", beeIndustrialProduction: "8" },
      machineHandlerId: "industrial-apiary",
    };
    const industrialRecipe = applyMachineHandlerToRecipe(recipe, node);

    expect(getMachineDurationMultiplier(industrialRecipe, node)).toBeCloseTo(1 / 256);
    expect(getMachineEutMultiplier(industrialRecipe, node)).toBeCloseTo((37 + 524288) / 37);
    expect(
      getMachineOutputMultiplier(industrialRecipe, node, recipe.outputs[0]!, "MV"),
    ).toBeCloseTo(Math.pow((17.19926784 + 8) / 0.1, 0.52));
  });

  it("models Mega Apiary batching and voltage slot scaling", () => {
    const recipe = enrichPassiveProductionRecipe(testBeeRecipe());
    const node: Pick<
      FactoryNode,
      "machineConfigTiers" | "machineHandlerId" | "coilTier" | "overclockTier"
    > = {
      machineConfigTiers: { beeMegaRoyalJelly: "full" },
      machineHandlerId: "mega-apiary",
      overclockTier: "ZPM",
    };
    const megaRecipe = applyMachineHandlerToRecipe(recipe, node);
    const stats = getOverclockedRecipeStats(megaRecipe, node);

    expect(megaRecipe.durationTicks).toBe(100);
    expect(stats.durationTicks).toBe(100);
    expect(stats.eut).toBe(8110 * 4);
    expect(getMachineOutputMultiplier(megaRecipe, node, recipe.outputs[0]!, "ZPM")).toBeCloseTo(
      (6400 / 550) * 4 * 3 * Math.pow((17.19926784 + 7) / 0.1, 0.52),
    );
  });
});

function testCropRecipe(): Recipe {
  return {
    id: "ic2-crop-stickle",
    name: "IC2 Crop: Stickreed",
    machineType: "IC2 Crop",
    minimumTier: "NONE",
    durationTicks: 1200,
    eut: 0,
    inputs: [
      {
        kind: "item",
        id: "IC2:itemCropSeed@1",
        amount: 1,
        displayName: "Stickreed Seeds",
        consumed: false,
      },
    ],
    outputs: [{ kind: "item", id: "IC2:itemHarz", amount: 1, displayName: "Sticky Resin" }],
    source: { recipeMap: "IC2 Crop" },
  };
}

function testBeeRecipe(): Recipe {
  return {
    id: "bee-explosive",
    name: "Bee Produce: Explosive Bee",
    machineType: "Bee Produce",
    minimumTier: "NONE",
    durationTicks: 550,
    eut: 0,
    inputs: [
      {
        kind: "item",
        id: "factoryflow:bee_species:gregtech-explosive",
        amount: 1,
        displayName: "Explosive Bee",
        consumed: false,
      },
    ],
    outputs: [{ kind: "item", id: "IC2:blockITNT", amount: 0.02, displayName: "Industrial TNT" }],
    source: { recipeMap: "Bee Produce" },
  };
}

describe("CropsNH harvesters", () => {
  // Oil Berry in 2.9: tier 4, 1200 growth points, base drop chance 0.95^4,
  // one drop of 2x at 100%. This is the crop the wiki's Crop Manager vs
  // Industrial Farm comparison table is built on.
  const OIL_BERRY_ID = "cropsnh:oilberry";
  const oilBerry = (): Recipe =>
    enrichPassiveProductionRecipe({
      id: "cropsnh-crop-oilberry",
      name: "Crop Farm: Oil Berry",
      machineType: "Crop Farm",
      minimumTier: "NONE",
      // Baked at the reference environment: score 55 -> rate 123 -> 10 cycles.
      durationTicks: 2560,
      eut: 0,
      inputs: [],
      outputs: [
        {
          kind: "item",
          id: OIL_BERRY_ID,
          amount: 0.95 ** 4 * 1.03 ** 31 * (2 + 32 / 100),
          displayName: "Oil Berry",
        },
      ],
      metadata: {
        cropsNh: {
          tier: 4,
          growthPoints: 1200,
          dropChance: 0.95 ** 4,
          growthCycleTicks: 256,
          growthMultiplier: 1,
          drops: [{ id: OIL_BERRY_ID, stackSize: 2, weight: 10000 }],
        },
      },
      source: { recipeMap: "Crop Farm" },
    });

  /** Items per 5 seconds from ONE crop, the unit the wiki table uses. */
  const per5Seconds = (node: Pick<FactoryNode, "machineConfigTiers"> & Partial<FactoryNode>) => {
    const recipe = oilBerry();
    const output = recipe.outputs[0]!;
    const full = { machineConfigTiers: {}, ...node };
    const seconds = (recipe.durationTicks * getMachineDurationMultiplier(recipe, full)) / 20;
    const amount = output.amount * getMachineOutputMultiplier(recipe, full, output, "LV");
    return (amount / seconds) * 5;
  };

  const WORLD_N27 = { cropWater: "100", cropFertilizer: "100", cropSky: "yes", cropBiome: "none" };
  const WORLD_N41 = { ...WORLD_N27, cropBiome: "one-tag" };

  it("starts the manager ladder at the LV machine, with no by-hand rung", () => {
    const recipe = oilBerry();
    // Crop sticks and an Industrial Farm are the two places a crop can live,
    // and a planned crop board is an automated one: the by-hand rung was
    // removed, so the ladder opens on the LV machine.
    expect(recipe.machineHandlers?.map((handler) => handler.id)).toEqual([
      "crop-manager",
      "crop-industrial-farm",
    ]);
    const manager = recipe.machineHandlers![0]!.machineConfigControls!.find(
      (control) => control.id === "cropManagerTier",
    )!;
    expect(manager.defaultKey).toBe("1");
    expect(manager.tiers[0]).toMatchObject({ key: "1", label: "LV" });
    expect(manager.tiers.map((tier) => tier.key)).not.toContain("none");
  });

  it("loads a legacy by-hand plan as the LV machine", () => {
    const recipe = oilBerry();
    const output = recipe.outputs[0]!;
    const at = (key: string) => ({ machineConfigTiers: { cropManagerTier: key } });
    // LV: 1 + 0.05 * 1 harvest rounds, and its full five-layer reach - for a
    // stored legacy "none" exactly as for an explicit LV pick.
    for (const key of ["none", "1"]) {
      expect(getMachineOutputMultiplier(recipe, at(key), output, "LV")).toBeCloseTo(1.05, 10);
      expect(
        cropsNhCropsPerMachine(cropsNhHarvesterFromTiers({ cropManagerTier: key }, "crop-manager")),
      ).toBe(605);
    }
  });

  it("hides water, fertilizer and sky on an Industrial Farm and shows them elsewhere", () => {
    const recipe = oilBerry();
    const controlIds = (handlerId: string) =>
      applyMachineHandlerToRecipe(recipe, { machineHandlerId: handlerId }).machineConfigControls?.map(
        (control) => control.id,
      ) ?? [];

    // The farm simulates water 200, fertilizer 200 and sky access, so a player
    // has nothing to set; a Crop Manager works real sticks and keeps all three.
    for (const id of ["cropWater", "cropFertilizer", "cropSky"]) {
      expect(controlIds("crop-industrial-farm")).not.toContain(id);
      expect(controlIds("crop-manager")).toContain(id);
    }
    expect(controlIds("crop-industrial-farm")).toContain("cropSeedBedTier");
    expect(controlIds("crop-manager")).toContain("cropManagerTier");
    // A seed bed always exists, so it never offers a "none" rung.
    const seedBed = applyMachineHandlerToRecipe(recipe, {
      machineHandlerId: "crop-industrial-farm",
    }).machineConfigControls!.find((control) => control.id === "cropSeedBedTier")!;
    expect(seedBed.tiers.map((tier) => tier.key)).not.toContain("none");
    // A card says how many sticks it has and who picks them. How the field is
    // stacked is the machine's business, never a question put to the player.
    expect(controlIds("crop-manager")).not.toContain("cropManagerLayers");
  });

  it("gives a Crop Manager its whole five-layer reach", () => {
    const capacity = (tierIndex: number) =>
      cropsNhCropsPerMachine(
        cropsNhHarvesterFromTiers({ cropManagerTier: String(tierIndex) }, "crop-manager"),
      );
    // getHorizontalRadius = 3 + 2*tier, getVerticalRadius = 2 -> (4t+7)^2 * 5.
    expect(capacity(1)).toBe(11 * 11 * 5);
    expect(capacity(2)).toBe(15 * 15 * 5);
    expect(capacity(8)).toBe(39 * 39 * 5);
    // A seed bed is a stack of seeds, not a field, so it gets no layer factor.
    expect(
      cropsNhCropsPerMachine(
        cropsNhHarvesterFromTiers({ cropSeedBedTier: "2" }, "crop-industrial-farm"),
      ),
    ).toBe(15 * 15);
  });

  it("reproduces the wiki's Crop Manager output table at every tier", () => {
    // Wiki: single same-tier Crop Manager, one planted layer, 31/31/31 seeds.
    const WIKI: Array<[tierIndex: number, n27: number, n41: number]> = [
      [2, 27, 35],
      [3, 45, 59],
      [4, 69, 90],
      [5, 99, 129],
      [6, 136, 177],
      [7, 180, 235],
      [8, 231, 302],
    ];
    for (const [tierIndex, n27, n41] of WIKI) {
      const sticks = cropsNhSquarePerTier(tierIndex);
      const node = (world: Record<string, string>) => ({
        machineHandlerId: "crop-manager",
        machineConfigTiers: { ...world, cropManagerTier: String(tierIndex) },
      });
      expect(Math.round(per5Seconds(node(WORLD_N27)) * sticks)).toBe(n27);
      expect(Math.round(per5Seconds(node(WORLD_N41)) * sticks)).toBe(n41);
    }
  });

  it("reproduces the wiki's Industrial Farm output at MV", () => {
    // MV seed bed: 1 upgrade slot, best spent on an Advanced Harvesting Unit.
    // Harvest rounds x(1 + 0.2*2) x(1 + 0.2) = 1.68, growth speed x1.
    const node = {
      machineHandlerId: "crop-industrial-farm",
      machineConfigTiers: { cropSeedBedTier: "2", cropIfHarvestUnits: "1" },
    };
    expect(Math.round(per5Seconds(node) * cropsNhSquarePerTier(2))).toBe(70);
  });

  it("applies the farm's growth speed and harvest round multipliers separately", () => {
    const recipe = oilBerry();
    const output = recipe.outputs[0]!;
    // IV seed bed: 4 slots -> 2 growth units, 1 fertilizer unit, 1 harvest unit.
    const node = {
      machineConfigTiers: {
        cropSeedBedTier: "5",
        cropIfGrowthUnits: "2",
        cropIfFertilizerUnits: "1",
        cropIfHarvestUnits: "1",
      },
      machineHandlerId: "crop-industrial-farm",
    };
    // speed = (1 + 2*1.0) * (1 + 0.5) = 4.5, so duration is 1/4.5 of a stick's.
    expect(getMachineDurationMultiplier(recipe, node)).toBeCloseTo(1 / 4.5, 10);
    // rounds = (1 + 0.2*5 + 0.5) * (1 + 0.2*1) = 2.5 * 1.2 = 3.0
    expect(getMachineOutputMultiplier(recipe, node, output, "LV")).toBeCloseTo(3, 10);
  });

  it("never spends more upgrade slots than the seed bed has", () => {
    // An MV farm has exactly one slot, so a card asking for four growth units
    // plus a fertilizer unit must not stack all five.
    const setup = cropsNhHarvesterFromTiers(
      { cropSeedBedTier: "2", cropIfGrowthUnits: "4", cropIfFertilizerUnits: "1" },
      "crop-industrial-farm",
    );
    expect(cropsNhUpgradeSlots(2)).toBe(1);
    expect(setup.growthUnits + setup.fertilizerUnits).toBeLessThanOrEqual(1);
  });

  it("squeezes EVERY unit type through the shared slot budget, not just growth", () => {
    // MTEIndustrialFarm: one 'U' upgrade position per slice, all five unit
    // types compete for them. An MV farm (1 slot) asked for a fertilizer
    // unit, two harvest units and two biome cards keeps only the first in
    // the degrade order.
    const setup = cropsNhHarvesterFromTiers(
      {
        cropSeedBedTier: "2",
        cropIfFertilizerUnits: "1",
        cropIfHarvestUnits: "2",
        cropIfEnvironmentUnits: "2",
      },
      "crop-industrial-farm",
    );
    expect(cropsNhUnitSlotsUsed(setup)).toBe(1);
    expect(setup.fertilizerUnits).toBe(1);
    expect(setup.harvestUnits).toBe(0);
    expect(setup.environmentUnits).toBe(0);
  });

  it("charges the Overclocked unit one slot and drops growth units under it", () => {
    // ZPM bed: 6 slots. The Overclocked unit is one block whatever its
    // overclock count, growth units are exclusive with it, and the rest of
    // the units still fit beside it.
    const setup = cropsNhHarvesterFromTiers(
      {
        cropSeedBedTier: "7",
        cropIfOverclocks: "4",
        cropIfGrowthUnits: "5",
        cropIfFertilizerUnits: "1",
        cropIfHarvestUnits: "2",
        cropIfEnvironmentUnits: "2",
      },
      "crop-industrial-farm",
    );
    expect(setup.overclocks).toBe(4);
    expect(setup.growthUnits).toBe(0);
    expect(setup.fertilizerUnits).toBe(1);
    expect(setup.harvestUnits).toBe(2);
    expect(setup.environmentUnits).toBe(2);
    expect(cropsNhUnitSlotsUsed(setup)).toBe(6);
  });

  it("stacks biome cards with the biome's real tags, never with the humidity substitute", () => {
    const farmEnv = (biomeKey: string, environmentUnits: number) =>
      cropsNhHarvesterEnvironment(
        cropsNhHarvesterFromTiers(
          {
            cropSeedBedTier: "3",
            cropBiome: biomeKey,
            cropIfEnvironmentUnits: String(environmentUnits),
          },
          "crop-industrial-farm",
        ),
        cropsNhEnvironmentFromTiers({ cropBiome: biomeKey }),
      ).biomeBonus;
    // A card adds one liked TAG (`getNutrientScore` adds module tags to the
    // biome's set), so one real tag plus one card is the full two-tag 28.
    expect(farmEnv("one-tag", 1)).toBe(28);
    // Tags cap at two; a third source of tags buys nothing.
    expect(farmEnv("two-tags", 2)).toBe(28);
    // The 80%-humidity substitute simulates ONE tag inside a max(), so one
    // card in a humid no-tag biome is still 14, and two cards reach 28.
    expect(farmEnv("humid", 1)).toBe(14);
    expect(farmEnv("humid", 2)).toBe(28);
    expect(farmEnv("none", 1)).toBe(14);
  });

  it("holds the seed bed at the crop's own minimum tier", () => {
    // `CHECK_RECIPE_RESULT_SEED_BED_TIER_TOO_LOW`: the farm refuses a seed
    // below its bed tier, so the ladder starts there and a stored lower
    // tier clamps UP - display and math alike.
    const setup = cropsNhHarvesterFromTiers(
      { cropSeedBedTier: "2" },
      "crop-industrial-farm",
      5,
    );
    expect(setup.tierIndex).toBe(5);
    const recipe = enrichPassiveProductionRecipe({
      ...oilBerry(),
      metadata: {
        cropsNh: {
          ...(oilBerry().metadata as { cropsNh: Record<string, unknown> }).cropsNh,
          minSeedBedTier: 5,
        },
      },
    });
    const seedBed = applyMachineHandlerToRecipe(recipe, {
      machineHandlerId: "crop-industrial-farm",
    }).machineConfigControls!.find((control) => control.id === "cropSeedBedTier")!;
    expect(seedBed.tiers[0]!.key).toBe("5");
    expect(seedBed.defaultKey).toBe("5");
  });

  it("gives a Crop Manager nothing from a machine-only crop", () => {
    // The guide's rule: Industrial Farm-only crops grow and spread in the
    // world but drop NOTHING on harvest; only the farm runs them.
    const base = oilBerry();
    const recipe = enrichPassiveProductionRecipe({
      ...base,
      metadata: {
        cropsNh: {
          ...(base.metadata as { cropsNh: Record<string, unknown> }).cropsNh,
          machineOnly: true,
        },
      },
    });
    const output = recipe.outputs[0]!;
    expect(
      getMachineOutputMultiplier(
        recipe,
        { machineHandlerId: "crop-manager", machineConfigTiers: { cropManagerTier: "3" } },
        output,
        "LV",
      ),
    ).toBe(0);
    expect(
      getMachineOutputMultiplier(
        recipe,
        {
          machineHandlerId: "crop-industrial-farm",
          machineConfigTiers: { cropSeedBedTier: "2" },
        },
        output,
        "LV",
      ),
    ).toBeGreaterThan(0);
  });

  it("walks the humidity gradient the way getNutrientsPerCycle does", () => {
    // floor(clamp((rainfall - 0.5) / 0.3, 0, 1) * 14): 60% is +4, 70% +9,
    // 80% the full simulated tag.
    const bonus = (key: string) =>
      cropsNhEnvironmentFromTiers({ cropBiome: key }).biomeBonus;
    expect(bonus("humid-60")).toBe(4);
    expect(bonus("humid-70")).toBe(9);
    expect(bonus("humid")).toBe(14);
  });

  it("only grants the farm's fertilizer food while fertilizer is fed", () => {
    const env = (tiers: Record<string, string>) =>
      cropsNhHarvesterEnvironment(
        cropsNhHarvesterFromTiers(tiers, "crop-industrial-farm"),
        cropsNhEnvironmentFromTiers(tiers),
      ).fertilizer;
    expect(env({ cropSeedBedTier: "2" })).toBe(200);
    expect(env({ cropSeedBedTier: "2", cropIfFertilized: "no" })).toBe(0);
    // A Fertilization Unit runs on enriched fertilizer, so it forces fed.
    expect(
      env({ cropSeedBedTier: "3", cropIfFertilized: "no", cropIfFertilizerUnits: "1" }),
    ).toBe(200);
  });

  it("bills a partially filled farm as a whole farm", () => {
    // A farm burns its full getPowerUsage however many seeds it holds: 900
    // seeds in 729-seat IV farms is TWO farms at full draw, not 1.23 farms.
    const setup = cropsNhHarvesterFromTiers({ cropSeedBedTier: "5" }, "crop-industrial-farm");
    expect(cropsNhFarmEut(setup)).toBeCloseTo(7680, 6);
    expect(cropsNhHarvesterMachineCount(setup, 900)).toBe(2);
    expect(cropsNhFarmEut(setup) * cropsNhHarvesterMachineCount(setup, 900)).toBeCloseTo(
      15360,
      6,
    );
  });

  it("bills the farm's units and overclocks the way getPowerUsage does", () => {
    // IV bed: base VP = 7680 EU/t. Two growth units (+1.25 each), one
    // fertilizer and one harvest unit (+0.5 each) make x4.5, spread over the
    // bed's 27x27 seeds.
    const setup = cropsNhHarvesterFromTiers(
      {
        cropSeedBedTier: "5",
        cropIfGrowthUnits: "2",
        cropIfFertilizerUnits: "1",
        cropIfHarvestUnits: "1",
      },
      "crop-industrial-farm",
    );
    expect(cropsNhEutPerCrop(setup) * cropsNhSquarePerTier(5)).toBeCloseTo(7680 * 4.5, 6);
    // The OverclockCalculator QUADRUPLES consumption per overclock while
    // production only doubles; the Overclocked unit itself adds no percentage.
    const overclocked = cropsNhHarvesterFromTiers(
      { cropSeedBedTier: "7", cropIfOverclocks: "2" },
      "crop-industrial-farm",
    );
    expect(cropsNhEutPerCrop(overclocked) * cropsNhSquarePerTier(7)).toBeCloseTo(
      Math.floor((8 * 4 ** 7 * 30) / 32) * 16,
      6,
    );
  });

  it("gives a bare card the LV manager's numbers, world pace included", () => {
    const bare = { machineConfigTiers: {} } as FactoryNode;
    const recipe = oilBerry();
    // A manager never speeds the crop up; it only rolls more harvests.
    expect(getMachineDurationMultiplier(recipe, bare)).toBe(1);
    expect(getMachineOutputMultiplier(recipe, bare, recipe.outputs[0]!, "LV")).toBeCloseTo(
      1.05,
      10,
    );
  });
});
