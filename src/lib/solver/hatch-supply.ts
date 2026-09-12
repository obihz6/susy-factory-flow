import type { FactoryProject, FactoryStorage } from "../model/types";
import { isHatchSuppliedInput } from "../model/hatch-supply";
import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { isRecipeInputConsumed } from "../model/resources";
import { inheritSharedMachineExpansion } from "../model/shared-machine";
import { parseResourceHandleId } from "@/components/flow/resource-handles";

export const HATCH_SUPPLY_PREFIX = "hatch-supply:";
export const isHatchSupplyId = (id: string) => id.startsWith(HATCH_SUPPLY_PREFIX);
const cache = new WeakMap<FactoryProject, FactoryProject>();

/** Run AFTER shared-machine/pool expansion. A private source supplies only
 * the selected card's input. Existing wires remain saved, but do not feed a
 * hatch-satisfied slot until it is switched off. No supply leaks into a pool.
 * Jack explicitly requested full satisfaction, abstracting counts and rates.
 */
export function expandHatchSupplies(project: FactoryProject): FactoryProject {
  const cached = cache.get(project);
  if (cached) return cached;
  if (!project.nodes.some((node) => node.hatchSupplies?.length)) return project;
  const recipes = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const storages: FactoryStorage[] = [...(project.storages ?? [])];
  let edges = project.edges;
  for (const node of project.nodes) {
    const recipe = recipes.get(node.recipeId);
    if (!recipe || node.enabled === false || !node.hatchSupplies?.length) continue;
    const inputs = applyRecipeInputOverrides(recipe, node).inputs;
    for (const resourceId of new Set(node.hatchSupplies)) {
      const input = inputs.find((input) => input.id === resourceId && input.amount > 0
        && isRecipeInputConsumed(input) && isHatchSuppliedInput(recipe, node, input));
      if (!input) continue;
      const id = `${HATCH_SUPPLY_PREFIX}${node.id}:${resourceId}`;
      // A cross-form edge names its target fluid in the handle, not its source.
      edges = edges.filter((edge) => {
        if (edge.target !== node.id) return true;
        const target = parseResourceHandleId(edge.targetHandle);
        return target
          ? target.kind !== input.kind || target.resourceId !== resourceId
          : edge.resourceKind !== input.kind || edge.resourceId !== resourceId;
      });
      storages.push({ id, kind: "fluid", resourceId, displayName: input.displayName, position: node.position });
      edges = [...edges, { id, source: id, target: node.id, resourceKind: "fluid", resourceId }];
    }
  }
  const expanded = { ...project, storages, edges };
  inheritSharedMachineExpansion(project, expanded);
  cache.set(project, expanded);
  cache.set(expanded, expanded);
  return expanded;
}
