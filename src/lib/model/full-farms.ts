import type { FactoryNode, FactoryProject, Recipe } from "./types";
import { CROP_HARVESTER_INDUSTRIAL_FARM_ID, cropsNhCropsPerMachine, cropsNhHarvesterFromTiers, getCropsNhStats } from "./passive-production";

export function industrialFarmCapacity(recipe: Recipe, node: FactoryNode): number | undefined {
  const stats = getCropsNhStats(recipe);
  if (!stats) return undefined;
  const setup = cropsNhHarvesterFromTiers(node.machineConfigTiers, node.machineHandlerId,
    stats.minSeedBedTier, stats.subSoil !== undefined);
  return setup.id === CROP_HARVESTER_INDUSTRIAL_FARM_ID ? cropsNhCropsPerMachine(setup) : undefined;
}

/** Keep the solver's seed count in sync with the user's chosen whole-farm count.
 * Legacy plans without the field retain their exact planting. */
export function normalizeFullFarms(project: FactoryProject): FactoryProject {
  const recipes = new Map(project.recipes.map(recipe => [recipe.id, recipe]));
  let changed = false;
  const nodes = project.nodes.map(node => {
    if (node.cropFullFarmCount === undefined) return node;
    const recipe = recipes.get(node.recipeId);
    const capacity = recipe && industrialFarmCapacity(recipe, node);
    if (!capacity) return node;
    const machineCount = node.cropFullFarmCount * capacity;
    if (machineCount === node.machineCount) return node;
    changed = true;
    return { ...node, machineCount };
  });
  return changed ? { ...project, nodes } : project;
}
