import { describe, expect, it } from "vitest";
import { customRecipeToRecipe, mergeCustomRecipes, validateCustomRecipe, type CustomRecipe } from "./custom-recipes";
import type { Recipe } from "@/lib/model/types";

const customRecipe: CustomRecipe = {
  id: "custom_recipe_001",
  internalName: "steam_age_steel_ingot",
  displayName: "Steam Age Steel Ingot",
  source: "local-dev",
  sourceVersion: "experimental-branch",
  createdAt: "2024-01-01T12:00:00.000Z",
  lastModifiedAt: "2024-01-02T15:30:00.000Z",
  modifiedBy: "user_input",
  baseRecipe: null,
  machine: "Assembly Line",
  duration: 320,
  EUt: 30,
  inputs: [{ item: "iron_plate", amount: 3, isFluid: false }],
  outputs: [{ item: "steel_ingot", amount: 1, probability: 100, isFluid: false }],
  properties: { parallel: false, cleanroom: false, voltageTier: "LV" },
  notes: "Experimental recipe",
  tags: ["experimental"],
};

function publishedRecipe(): Recipe {
  return {
    id: "steel",
    name: "Steel",
    kind: "gregtech_machine",
    machineType: "Furnace",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 2,
    inputs: [{ kind: "item", id: "iron", amount: 1 }],
    outputs: [{ kind: "item", id: "steel", amount: 1 }],
  };
}

describe("custom recipe model", () => {
  it("rejects duplicate names within the same local version", () => {
    const result = validateCustomRecipe(customRecipe, { existing: [customRecipe] });
    expect(result.errors).toHaveLength(1);
  });

  it("converts a custom record to a planner recipe", () => {
    const recipe = customRecipeToRecipe(customRecipe);
    expect(recipe.kind).toBe("custom");
    expect(recipe.machineType).toBe("Assembly Line");
    expect(recipe.inputs[0]).toMatchObject({ kind: "item", id: "iron_plate", amount: 3 });
    expect(recipe.metadata?.customRecipeId).toBe(customRecipe.id);
  });

  it("replaces a published recipe without duplicating it", () => {
    const override = { ...customRecipe, baseRecipe: { versionId: "stable", recipeId: "steel" } };
    const merged = mergeCustomRecipes([publishedRecipe()], [override]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("custom");
    expect(merged[0].overriddenRecipeId).toBe("steel");
  });
});
