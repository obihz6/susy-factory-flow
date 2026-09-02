import type { DatasetResource, DatasetResourceIndexEntry, RecipeDataset } from "./types";
import type { Recipe, ResourceAmount } from "../model/types";
import { expandMachineRecipeVariants } from "../model/recipe-rules";
import { enrichPassiveProductionRecipe } from "../model/passive-production";
import {
  knownRecipeMapSlotCapacity,
  mergeRecipeMapSlotCapacity,
  type RecipeMapSlotCapacity,
} from "../model/recipe-map-capacities";

export function enrichDatasetRecipes(dataset: RecipeDataset): RecipeDataset {
  const resourcesByKey = new Map(
    dataset.resources.map((resource) => [`${resource.kind}:${resource.id}`, resource] as const),
  );
  const slotCapacitiesByRecipeMap = buildRecipeMapSlotCapacities(dataset.recipes);

  const recipes = expandMachineRecipeVariants(
    dataset.recipes.map((recipe) =>
      enrichPassiveProductionRecipe(
        enrichRecipe(recipe, resourcesByKey, slotCapacitiesByRecipeMap),
      ),
    ),
  );

  return {
    ...dataset,
    recipes,
    resourceIndex: buildDatasetResourceIndex(recipes),
  };
}

export function buildDatasetResourceIndex(recipes: Recipe[]): DatasetResourceIndexEntry[] {
  const index = new Map<string, DatasetResourceIndexEntry>();

  for (const recipe of recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      const key = `${resource.kind}:${resource.id}`;
      const existing = index.get(key);
      if (existing) {
        existing.recipeCount += 1;
        if (!existing.iconPath && resource.iconPath) {
          existing.iconPath = resource.iconPath;
        }
        if (!existing.iconAtlas && resource.iconAtlas) {
          existing.iconAtlas = resource.iconAtlas;
        }
        if (!existing.dominantColor) {
          existing.dominantColor = resource.dominantColor ?? resource.iconAtlas?.dominantColor;
        }
        if (!existing.displayName && resource.displayName) {
          existing.displayName = resource.displayName;
        }
        if (!existing.alternatives && resource.alternatives) {
          existing.alternatives = resource.alternatives;
        }
      } else if (resource.kind === "power") {
        // Power is app-synthesized, never a dataset resource; nothing to index.
      } else {
        index.set(key, {
          kind: resource.kind,
          id: resource.id,
          displayName: resource.displayName,
          iconPath: resource.iconPath,
          iconAtlas: resource.iconAtlas,
          dominantColor: resource.dominantColor ?? resource.iconAtlas?.dominantColor,
          recipeCount: 1,
          alternatives: resource.alternatives,
        });
      }
    }
  }

  return [...index.values()];
}

function enrichRecipe(
  recipe: Recipe,
  resourcesByKey: Map<string, DatasetResource>,
  slotCapacitiesByRecipeMap: Map<string, RecipeMapSlotCapacity>,
): Recipe {
  const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
  const slotCapacity = mergeRecipeMapSlotCapacity(
    slotCapacitiesByRecipeMap.get(recipeMap),
    knownRecipeMapSlotCapacity(recipeMap),
  );

  return {
    ...recipe,
    inputs: recipe.inputs.map((resource) => enrichResource(resource, resourcesByKey)),
    outputs: recipe.outputs.map((resource) => enrichResource(resource, resourcesByKey)),
    nei: slotCapacity
      ? {
          ...recipe.nei,
          slotCapacity: mergeRecipeMapSlotCapacity(recipe.nei?.slotCapacity, slotCapacity),
        }
      : recipe.nei,
  };
}

function enrichResource<T extends ResourceAmount>(
  resource: T,
  resourcesByKey: Map<string, DatasetResource>,
): T {
  const indexed = resourcesByKey.get(`${resource.kind}:${resource.id}`);
  if (!indexed) {
    return resource;
  }

  return {
    ...indexed,
    ...resource,
    displayName: resource.displayName ?? indexed.displayName,
    iconPath: isLegacyRenderedIconPath(resource.iconPath)
      ? indexed.iconPath
      : (resource.iconPath ?? indexed.iconPath),
    iconAtlas: resource.iconAtlas ?? indexed.iconAtlas,
    dominantColor:
      resource.dominantColor ??
      indexed.dominantColor ??
      resource.iconAtlas?.dominantColor ??
      indexed.iconAtlas?.dominantColor,
    tooltip: resource.tooltip ?? indexed.tooltip,
    modId: resource.modId ?? indexed.modId,
    alternatives: resource.alternatives ?? indexed.alternatives,
  };
}

function isLegacyRenderedIconPath(iconPath: string | undefined): boolean {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

function buildRecipeMapSlotCapacities(recipes: Recipe[]): Map<string, RecipeMapSlotCapacity> {
  const capacities = new Map<string, RecipeMapSlotCapacity>();

  for (const recipe of recipes) {
    const recipeMap = recipe.source?.recipeMap ?? recipe.machineType;
    const existing = capacities.get(recipeMap) ?? {};
    capacities.set(recipeMap, mergeRecipeMapSlotCapacity(existing, observedSlotCapacity(recipe)));
  }

  return capacities;
}

function observedSlotCapacity(recipe: Recipe): RecipeMapSlotCapacity {
  return compactSlotCapacity({
    maxItemInputs: boundedSharedCapacity(
      countKind(recipe.inputs, "item"),
      gridCapacity(recipe.nei?.itemInputGrid),
    ),
    maxItemOutputs: boundedSharedCapacity(
      countKind(recipe.outputs, "item"),
      gridCapacity(recipe.nei?.itemOutputGrid),
    ),
    maxFluidInputs: boundedSharedCapacity(
      countKind(recipe.inputs, "fluid"),
      gridCapacity(recipe.nei?.fluidInputGrid),
    ),
    maxFluidOutputs: boundedSharedCapacity(
      countKind(recipe.outputs, "fluid"),
      gridCapacity(recipe.nei?.fluidOutputGrid),
    ),
  });
}

function boundedSharedCapacity(resourceCount: number, gridCount?: number): number | undefined {
  const capacity = Math.max(resourceCount, gridCount ?? 0);
  return capacity > 1 && capacity <= 6 ? capacity : undefined;
}

function gridCapacity(grid?: { width: number; height: number }): number | undefined {
  if (!grid) {
    return undefined;
  }

  return Math.max(0, grid.width * grid.height);
}

function compactSlotCapacity(capacity: RecipeMapSlotCapacity): RecipeMapSlotCapacity {
  return Object.fromEntries(
    Object.entries(capacity).filter(([, value]) => typeof value === "number" && value > 0),
  ) as RecipeMapSlotCapacity;
}

function countKind(resources: ResourceAmount[], kind: ResourceAmount["kind"]) {
  return resources.filter((resource) => resource.kind === kind).length;
}
