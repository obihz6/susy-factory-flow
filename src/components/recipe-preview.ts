import type { RecipeSummary } from "@/lib/datasets/types";
import { resourceMatchesInput } from "@/lib/model";
import type { Recipe, ResourceAmount } from "@/lib/model/types";

export type PreviewContextResource = Pick<
  ResourceAmount,
  "kind" | "id" | "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

export function summaryToPreviewRecipe(summary: RecipeSummary): Recipe {
  return {
    id: summary.id,
    name: summary.name,
    kind: summary.kind,
    category: summary.category,
    machineType: summary.machineType,
    minimumTier: summary.minimumTier,
    durationTicks: summary.durationTicks,
    eut: summary.eut,
    inputs: summary.inputs,
    outputs: summary.outputs,
    programmedCircuit: summary.programmedCircuit,
    specialValue: summary.specialValue,
    machineHandlers: summary.machineHandlers,
    machineConfigControls: summary.machineConfigControls,
    source: summary.source ?? (summary.recipeMap ? { recipeMap: summary.recipeMap } : undefined),
    metadata: summary.metadata,
    nei: summary.nei,
  };
}

export function contextualizePreviewRecipe(
  recipe: Recipe,
  resource: PreviewContextResource | undefined,
): Recipe {
  if (!resource) {
    return recipe;
  }

  let changed = false;
  const inputs = recipe.inputs.map((input) => {
    if (!resourceMatchesInput(resource, input)) {
      return input;
    }

    if (input.kind !== resource.kind) {
      return input;
    }

    changed = true;
    return {
      ...input,
      kind: resource.kind,
      id: resource.id,
      displayName: resource.displayName ?? input.displayName,
      iconPath: resource.iconPath ?? input.iconPath,
      iconAtlas: resource.iconAtlas ?? input.iconAtlas,
      dominantColor: resource.dominantColor ?? input.dominantColor,
      alternatives: undefined,
    };
  });
  const outputs = recipe.outputs.map((output) => {
    if (output.kind !== resource.kind || output.id !== resource.id) {
      return output;
    }

    changed = true;
    return {
      ...output,
      displayName: resource.displayName ?? output.displayName,
      iconPath: resource.iconPath ?? output.iconPath,
      iconAtlas: resource.iconAtlas ?? output.iconAtlas,
      dominantColor: resource.dominantColor ?? output.dominantColor,
    };
  });

  return changed ? { ...recipe, inputs, outputs } : recipe;
}
