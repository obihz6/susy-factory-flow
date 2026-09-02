import { describe, expect, it } from "vitest";
import { enrichDatasetRecipes } from "./enrich";
import type { RecipeDataset } from "./types";

describe("enrichDatasetRecipes", () => {
  it("copies dataset resource icons into recipe amounts without changing amounts", () => {
    const dataset: RecipeDataset = {
      schemaVersion: 1,
      datasetVersionId: "test",
      gtnhVersion: "test",
      sourceInfo: { sourceId: "recex", generatedAt: "2026-01-01T00:00:00.000Z" },
      resources: [
        {
          id: "gregtech:gt.metaitem.01@1",
          kind: "item",
          displayName: "Test Dust",
          iconPath: "/datasets/gtnh/test/textures/rendered/test-dust.png",
        },
      ],
      recipes: [
        {
          id: "recipe",
          name: "Recipe",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 20,
          eut: 8,
          inputs: [{ kind: "item", id: "gregtech:gt.metaitem.01@1", amount: 2 }],
          outputs: [{ kind: "item", id: "minecraft:stone", amount: 1 }],
        },
      ],
      oreDictionary: {},
      recipeMaps: ["Assembler"],
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.inputs[0]).toMatchObject({
      amount: 2,
      displayName: "Test Dust",
      iconPath: "/datasets/gtnh/test/textures/rendered/test-dust.png",
    });
  });

  it("adds shared recipe map slot capacities to recipes with partial outputs", () => {
    const dataset = baseDataset([
      {
        id: "partial-electrolyzer",
        name: "Partial Electrolyzer",
        machineType: "Electrolyzer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "a", amount: 1 },
          { kind: "item", id: "b", amount: 1 },
          { kind: "item", id: "c", amount: 1 },
        ],
        source: { recipeMap: "Electrolyzer" },
      },
      {
        id: "full-electrolyzer",
        name: "Full Electrolyzer",
        machineType: "Electrolyzer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "a", amount: 1 },
          { kind: "item", id: "b", amount: 1 },
          { kind: "item", id: "c", amount: 1 },
          { kind: "item", id: "d", amount: 1 },
          { kind: "item", id: "e", amount: 1 },
          { kind: "item", id: "f", amount: 1 },
        ],
        source: { recipeMap: "Electrolyzer" },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.nei?.slotCapacity).toMatchObject({
      maxItemOutputs: 6,
    });
  });

  it("applies known recipe map slot capacity overrides to exported name variants", () => {
    const dataset = baseDataset([
      {
        id: "partial-multiblock-electrolyzer",
        name: "Partial Multiblock Electrolyzer",
        machineType: "Multiblock Electrolyzer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [
          { kind: "item", id: "a", amount: 1 },
          { kind: "item", id: "b", amount: 1 },
        ],
        source: { recipeMap: "multiblock electrolyzer recipes" },
      },
      {
        id: "partial-chemical-plant",
        name: "Partial Chemical Plant",
        machineType: "Chemical Plant",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "fluid", id: "acid", amount: 1000 }],
        source: { recipeMap: "chemical plant recipe map" },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.nei?.slotCapacity).toMatchObject({
      maxItemOutputs: 6,
      maxFluidInputs: 6,
      maxFluidOutputs: 6,
    });
    expect(enriched.recipes[1]?.nei?.slotCapacity).toMatchObject({
      maxItemInputs: 4,
      maxItemOutputs: 6,
      maxFluidInputs: 4,
      maxFluidOutputs: 3,
    });
  });

  it("keeps shared single-block recipe maps grouped for machine handler selection", () => {
    const dataset = baseDataset([
      {
        id: "single-mixer",
        name: "Mixer: Product",
        machineType: "Mixer",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "product", amount: 1 }],
        source: { recipeMap: "Mixer" },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes).toHaveLength(1);
    expect(enriched.recipes[0]).toMatchObject({
      machineType: "Mixer",
      source: { recipeMap: "Mixer" },
    });
  });

  it("does not add heating coils as fake NEI inputs", () => {
    const dataset = baseDataset([
      {
        id: "ebf",
        name: "Blast Furnace: Hot Ingot",
        machineType: "Blast Furnace",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 120,
        inputs: [{ kind: "item", id: "dust", amount: 1 }],
        outputs: [{ kind: "item", id: "hot_ingot", amount: 1 }],
        source: { recipeMap: "Blast Furnace" },
        nei: { additionalInfo: ["Special value: 2700"] },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.inputs).toHaveLength(1);
  });

  it("adds first-pass IC2 crop production controls without manual harvest", () => {
    const dataset = baseDataset([
      {
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
            tooltip: ["IC2:itemCropSeed", "Not a generated line"],
            consumed: false,
          },
        ],
        outputs: [{ kind: "item", id: "IC2:itemHarz", amount: 1, displayName: "Sticky Resin" }],
        source: { recipeMap: "IC2 Crop" },
      },
    ]);

    const recipe = enrichDatasetRecipes(dataset).recipes[0];
    const statControl = recipe?.machineConfigControls?.find(
      (control) => control.id === "cropStats",
    );

    expect(recipe).toMatchObject({
      machineType: "Crop Manager",
      minimumTier: "NONE",
      eut: 0,
    });
    expect(recipe?.machineHandlers).toEqual([]);
    expect(recipe?.inputs[0]?.tooltip).toEqual(["Not a generated line"]);
    expect(statControl?.defaultKey).toBe("23-31-0");
    expect(statControl?.tiers.map((tier) => tier.label)).toEqual(["1/1/1", "23/31/0"]);
  });

  it("adds bee production handlers and machine-specific controls", () => {
    const dataset = baseDataset([
      {
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
            tooltip: ["Bee species", "Source: GregTech", "Explosive Bee"],
            consumed: false,
          },
        ],
        outputs: [
          { kind: "item", id: "IC2:blockITNT", amount: 0.02, displayName: "Industrial TNT" },
        ],
        source: { recipeMap: "Bee Produce" },
      },
    ]);

    const recipe = enrichDatasetRecipes(dataset).recipes[0];

    expect(recipe).toMatchObject({
      machineType: "Apiary",
      minimumTier: "NONE",
      eut: 0,
    });
    expect(recipe?.inputs[0]?.tooltip).toBeUndefined();
    expect(recipe?.machineHandlers?.map((handler) => handler.label)).toEqual([
      "Magic Apiary",
      "Alveary",
      "Industrial Apiary",
      "Mega Apiary",
    ]);
    expect(recipe?.machineConfigControls?.map((control) => control.id)).toEqual([
      "beeSpeedGene",
      "beeFrameSlot1",
      "beeFrameSlot2",
      "beeFrameSlot3",
      "beeEnvironment",
    ]);
    expect(
      recipe?.machineConfigControls
        ?.find((control) => control.id === "beeEnvironment")
        ?.tiers.map((tier) => tier.label),
    ).toEqual(["Wrong", "Tolerated", "Preferred", "Controlled"]);
    expect(
      recipe?.machineHandlers
        ?.find((handler) => handler.id === "alveary")
        ?.machineConfigControls?.map((control) => control.id),
    ).toEqual([
      "beeSpeedGene",
      "beeAlvearyFrameHousing",
      "beeAlvearyStimulator",
      "beeAlvearySupport",
      "beeEnvironment",
    ]);
    expect(
      recipe?.machineHandlers
        ?.find((handler) => handler.id === "industrial-apiary")
        ?.machineConfigControls?.map((control) => control.id),
    ).toEqual(["beeSpeedGene", "beeIndustrialSpeed", "beeIndustrialProduction", "beeEnvironment"]);
    expect(
      recipe?.machineHandlers
        ?.find((handler) => handler.id === "mega-apiary")
        ?.machineConfigControls?.map((control) => control.id),
    ).toEqual(["beeSpeedGene", "beeMegaRoyalJelly"]);
  });

  it("does not treat ordinary craft names as passive production", () => {
    const dataset = baseDataset([
      {
        id: "mana-apiary-booster",
        name: "Shaped Crafting: Mana Apiary Booster",
        machineType: "Shaped Crafting",
        minimumTier: "NONE",
        durationTicks: 1,
        eut: 0,
        inputs: [{ kind: "item", id: "plate", amount: 1 }],
        outputs: [{ kind: "item", id: "apiary_booster", amount: 1 }],
        source: { recipeMap: "Shaped Crafting" },
      },
      {
        id: "crop-manager",
        name: "Shaped Crafting: Crop Manager (LV)",
        machineType: "Shaped Crafting",
        minimumTier: "NONE",
        durationTicks: 1,
        eut: 0,
        inputs: [{ kind: "item", id: "robot_arm", amount: 1 }],
        outputs: [{ kind: "item", id: "crop_manager", amount: 1 }],
        source: { recipeMap: "Shaped Crafting" },
      },
    ]);

    const enriched = enrichDatasetRecipes(dataset);

    expect(enriched.recipes[0]?.machineConfigControls).toBeUndefined();
    expect(enriched.recipes[0]?.machineHandlers).toBeUndefined();
    expect(enriched.recipes[1]?.machineConfigControls).toBeUndefined();
    expect(enriched.recipes[1]?.machineHandlers).toBeUndefined();
  });
});

function baseDataset(recipes: RecipeDataset["recipes"]): RecipeDataset {
  return {
    schemaVersion: 1,
    datasetVersionId: "test",
    gtnhVersion: "test",
    sourceInfo: { sourceId: "recex", generatedAt: "2026-01-01T00:00:00.000Z" },
    resources: [],
    recipes,
    oreDictionary: {},
    recipeMaps: [
      ...new Set(recipes.map((recipe) => recipe.source?.recipeMap ?? recipe.machineType)),
    ],
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}
