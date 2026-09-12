import type { FactoryNode, Recipe, ResourceAmount } from "./types";
import { getSelectedMachineHandler } from "./recipe-rules";

/** Ordinary fluid-input hatch support, verified against GT5U structure definitions.
 * Keep this explicit: being a multiblock alone does not prove hatch compatibility.
 * Chemical Plant (casing caps hatch tier), fusion (dedicated hatches), and unknown
 * machines deliberately do not opt in. See docs/hatch-supply.md.
 */
const FLUID_HATCH_MACHINES = new Set([
  "Large Chemical Reactor", "Mega Chemical Reactor", "Vacuum Freezer",
  "Cryogenic Freezer", "Endothermic Fridge", "Industrial Centrifuge",
  "Industrial Mixing Machine", "Industrial Chemical Bath", "Industrial Cutting Factory",
  "Ore Washing Plant", "Distillation Tower", "Mega Distillation Tower",
  "Dangote Distillus", "Steam Purifier", "Steam Blender",
  "Industrial Autoclave", "Big Barrel Brewery", "TurboCan Pro", "Mass Solidifier",
  "Exo-Foundry", "Spinmatron-2737", "Industrial Forming Press",
  "Large Scale Auto-Assembler v1.01", "Precise Auto-Assembler MT-3662",
  "Thermic Heating Device",
]);

export function getInputSupplyHatch(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineHandlerId">,
  resource: Pick<ResourceAmount, "kind" | "id">,
): string | undefined {
  if (resource.kind !== "fluid" || (resource.id !== "water" && resource.id !== "air")) return;
  const handler = getSelectedMachineHandler(recipe, node);
  if (!FLUID_HATCH_MACHINES.has(handler.machineType)) return;
  // The fallback handler is stamped single even for real multiblocks in old
  // plans. Its verified name is sufficient, but an explicit single is not.
  if (recipe.machineHandlers?.length && handler.kind !== "multiblock") return;
  return resource.id === "water" ? "Reservoir Hatch" : "Air Intake Hatch";
}

export function isHatchSuppliedInput(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineHandlerId" | "hatchSupplies">,
  resource: Pick<ResourceAmount, "kind" | "id">,
): boolean {
  return Boolean(node.hatchSupplies?.some((id) => id === resource.id) && getInputSupplyHatch(recipe, node, resource));
}
