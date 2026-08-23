import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./normalize-susy-recipedump.mjs", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixture-recipedump.json", import.meta.url));

/**
 * The normalizer runs at import time, so it is exercised the way the pipeline
 * runs it: as a subprocess over the synthetic fixture dump.
 */
function normalize() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-susy-"));
  const output = path.join(dir, "recipes.json");
  execFileSync(
    process.execPath,
    [scriptPath, fixturePath, output],
    {
      env: {
        ...process.env,
        SUSY_DATASET_VERSION_ID: "susy-test",
        SUSY_DATASET_VERSION_LABEL: "0.1.16.7.1",
      },
      stdio: "pipe",
    },
  );
  const dataset = JSON.parse(fs.readFileSync(output, "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return dataset;
}

const dataset = normalize();

describe("normalize-susy-recipedump", () => {
  it("produces a v1 dataset with oracle source info", () => {
    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.datasetVersionId).toBe("susy-test");
    expect(dataset.gtnhVersion).toBe("0.1.16.7.1");
    expect(dataset.sourceInfo.sourceId).toBe("gtnh-oracle");
  });

  it("prettifies recipe map names and folds tier variants into one family", () => {
    const maceratorRecipes = dataset.recipes.filter((r) => r.machineType === "Macerator");
    expect(maceratorRecipes.length).toBe(3);
    // Tier variants (macerator.lv / .hv) fold into ONE family so the
    // alternative-machine selector lists machines, not voltage tiers.
    const handlers = maceratorRecipes[0].machineHandlers;
    expect(handlers.map((h) => h.label)).toEqual(["Macerator"]);
    expect(handlers[0].kind).toBe("single");
    expect(handlers[0].minimumTier).toBe("LV");
  });

  it("maps item inputs and outputs to GTNH-style resource ids", () => {
    const oreRecipe = dataset.recipes.find(
      (r) => r.machineType === "Macerator" && r.eut === 8,
    );
    expect(oreRecipe.inputs[0]).toMatchObject({
      kind: "item",
      id: "gregtech:meta_item_1@1204",
      amount: 1,
    });
    expect(oreRecipe.outputs[0]).toMatchObject({
      kind: "item",
      id: "gregtech:dust@555",
      amount: 1,
    });
    expect(oreRecipe.minimumTier).toBe("ULV");
    expect(oreRecipe.durationTicks).toBe(100);
  });

  it("joins fluid inputs through the fluid catalog", () => {
    const leachRecipe = dataset.recipes.find((r) => r.eut === 30);
    const water = leachRecipe.inputs.find((input) => input.kind === "fluid");
    expect(water.id).toBe("water");
    expect(water.amount).toBe(100);
    expect(leachRecipe.specialValue).toBe(1700);
  });

  it("normalizes chanced outputs to fractions flagged as byproducts", () => {
    const leachRecipe = dataset.recipes.find((r) => r.eut === 30);
    const chancedDust = leachRecipe.outputs.find((o) => o.chance !== undefined && o.kind === "item");
    expect(chancedDust.chance).toBeCloseTo(0.3);
    // With no guaranteed output present, the first chanced entry is the
    // recipe's effective product and carries no byproduct flag.
    expect(chancedDust.byproduct).toBeUndefined();
    const chancedFluid = leachRecipe.outputs.find(
      (o) => o.id === "susy.acidic_ore_leach",
    );
    expect(chancedFluid.chance).toBe(0.5);
    expect(chancedFluid.byproduct).toBe(true);
  });

  it("detects non-consumable programmed circuits", () => {
    const circuitRecipe = dataset.recipes.find(
      (r) => r.programmedCircuit !== undefined,
    );
    expect(circuitRecipe.programmedCircuit).toBe("7");
    const circuitInput = circuitRecipe.inputs[0];
    expect(circuitInput.consumed).toBe(false);
  });

  it("carries the ore dictionary and stamps membership on resources", () => {
    expect(dataset.oreDictionary.ingotIron).toEqual(["minecraft:iron_ingot"]);
    const ingot = dataset.resources.find((r) => r.id === "minecraft:iron_ingot");
    expect(ingot.oreDictionary).toContain("ingotIron");
    expect(ingot.displayName).toBe("Iron Ingot");
  });

  it("synthesizes electric-furnace timing for smelting entries", () => {
    const smelt = dataset.recipes.find((r) => r.machineType === "Electric Furnace");
    expect(smelt.durationTicks).toBe(128);
    expect(smelt.eut).toBe(4);
    expect(smelt.metadata.synthesizedDuration).toBe(true);
    expect(smelt.minimumTier).toBe("LV");
  });

  it("exports crafting recipes as instant with alternatives", () => {
    const craft = dataset.recipes.find((r) => r.machineType === "Crafting Table");
    expect(craft.durationTicks).toBe(0);
    expect(craft.inputs[0].id).toBe("minecraft:iron_nugget");
    expect(craft.inputs[0].alternatives[0].id).toBe("susy:iron_nugget_hot");
  });

  it("lists distinct recipe maps sorted", () => {
    expect(dataset.recipeMaps).toEqual([
      "Crafting Table",
      "Electric Furnace",
      "Macerator",
    ]);
  });
});
