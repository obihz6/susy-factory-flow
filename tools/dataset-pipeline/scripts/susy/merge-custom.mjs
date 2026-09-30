import fs from "node:fs/promises";
import path from "node:path";
import { writeDatasetJson } from "../dataset-json-writer.mjs";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  requireFile,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

await executeStandaloneStep("merge-custom", async (logger, config) => {
  requireFile(config.paths.recipesPath, "normalized recipe dataset");
  const dataset = JSON.parse(await fs.readFile(config.paths.recipesPath, "utf8"));
  const storePath = path.join(repoRoot, "data", "custom-recipes", "local-dev.json");
  const store = await readStore(storePath);
  const active = store.recipes.filter((recipe) => !recipe.deletedAt);
  const allCustomIds = new Set(store.recipes.map((recipe) => recipe.id));
  const activeIds = new Set(active.map((recipe) => recipe.id));
  const overrides = new Map(active.filter((recipe) => recipe.baseRecipe?.recipeId).map((recipe) => [recipe.baseRecipe.recipeId, recipe]));
  const replaced = new Set();
  // Remove custom records from a prior run before applying the current store.
  // This keeps retries idempotent, including newly-added recipes without a base.
  dataset.recipes = dataset.recipes.filter((recipe) => !allCustomIds.has(recipe.id)).map((recipe) => {
    const custom = overrides.get(recipe.id);
    if (!custom) return recipe;
    replaced.add(custom.id);
    logger.info(`Applying custom override ${custom.id} to ${recipe.id}.`);
    return toDatasetRecipe(custom, recipe.id);
  });

  for (const custom of active) {
    if (custom.baseRecipe?.recipeId && replaced.has(custom.id)) continue;
    dataset.recipes.push(toDatasetRecipe(custom));
  }
  dataset.recipeMaps = [...new Set([...(dataset.recipeMaps ?? []), ...active.map((recipe) => recipe.machine)])].sort();
  dataset.resources ??= [];
  const resourceKeys = new Set(dataset.resources.map((resource) => `${resource.kind}:${resource.id}`));
  for (const custom of active) {
    for (const entry of [...custom.inputs, ...custom.outputs]) {
      const kind = entry.isFluid ? "fluid" : "item";
      const key = `${kind}:${entry.item}`;
      if (!resourceKeys.has(key)) {
        dataset.resources.push({ kind, id: entry.item, displayName: entry.item });
        resourceKeys.add(key);
      }
    }
  }
  await writeDatasetJson(config.paths.recipesPath, dataset);
  logger.info(`Merged ${active.length} active custom recipe(s); ${replaced.size} published recipe(s) overridden.`);
  return { customRecipeCount: active.length, overriddenRecipeCount: replaced.size };
}, options);

async function readStore(filePath) {
  try {
    const store = JSON.parse(await fs.readFile(filePath, "utf8"));
    validateStore(store);
    return store;
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, recipes: [] };
    throw error;
  }
}

function validateStore(store) {
  if (!store || store.schemaVersion !== 1 || !Array.isArray(store.recipes)) throw new Error("Custom recipe store must contain schemaVersion 1 and recipes[].");
  for (const recipe of store.recipes) {
    if (recipe.source !== "local-dev" || !recipe.id || !recipe.machine || !Array.isArray(recipe.inputs) || !Array.isArray(recipe.outputs)) throw new Error(`Invalid custom recipe ${recipe.id ?? "unknown"}.`);
  }
}

function toDatasetRecipe(custom, overriddenRecipeId) {
  const sourceVersion = custom.sourceVersion || "local-dev";
  return {
    id: custom.id,
    name: custom.displayName,
    kind: "custom",
    machineType: custom.machine,
    minimumTier: custom.properties?.voltageTier || "LV",
    durationTicks: custom.duration,
    eut: custom.EUt,
    inputs: custom.inputs.map((entry, index) => ({
      kind: entry.isFluid ? "fluid" : "item",
      id: entry.item,
      amount: entry.amount,
      displayName: entry.item,
      neiSlot: { x: 6, y: 4 + index * 18 },
    })),
    outputs: custom.outputs.map((entry, index) => ({
      kind: entry.isFluid ? "fluid" : "item",
      id: entry.item,
      amount: entry.amount,
      displayName: entry.item,
      ...(entry.probability < 100 ? { chance: entry.probability / 100, byproduct: index > 0 } : {}),
      neiSlot: { x: 102, y: 4 + index * 18 },
    })),
    notes: custom.notes,
    source: {
      datasetVersionId: sourceVersion,
      recipeMap: custom.machine,
      exporter: "unknown",
      sourceIdentifier: custom.id,
      ...(overriddenRecipeId ? { rawRecipeId: overriddenRecipeId } : {}),
    },
    metadata: {
      customRecipeId: custom.id,
      customOverride: overriddenRecipeId,
      tags: custom.tags,
      parallel: custom.properties?.parallel,
      cleanroom: custom.properties?.cleanroom,
      baseRecipe: custom.baseRecipe,
    },
  };
}
