import type { DatasetVersion } from "./types";
import { queryRecipeDatasetRecipes } from "./browser-loader";
import { DEFAULT_DATASET_MANIFEST_URL } from "./remote";

/**
 * The litres one filled cell holds of a given fluid, read from the Canner's
 * own recipes: the emptying recipe's fluid output first (filled cell in,
 * fluid out), the filling recipe's fluid input as the fallback. 1000 L for
 * most cells, 144 L for molten metals - never guessed, which is why a loose
 * cell wire cannot be drawn for a cell the Canner does not know.
 */
export async function fetchLitresPerCell(
  version: DatasetVersion,
  cellId: string,
  fluidId: string,
): Promise<number | undefined> {
  for (const mode of ["uses", "recipes"] as const) {
    try {
      const result = await queryRecipeDatasetRecipes(DEFAULT_DATASET_MANIFEST_URL, version, {
        query: "",
        mode,
        maxTier: "all",
        offset: 0,
        limit: 20,
        recipeMap: "Canner",
        resource: { kind: "item", id: cellId },
      });
      for (const recipe of result.recipes) {
        const slots = mode === "uses" ? recipe.outputs : recipe.inputs;
        const fluid = slots?.find((slot) => slot.kind === "fluid" && slot.id === fluidId);
        if (fluid && fluid.amount > 0) {
          return fluid.amount;
        }
      }
    } catch {
      // A failed lookup refuses the wire rather than guessing a ratio.
    }
  }
  return undefined;
}
