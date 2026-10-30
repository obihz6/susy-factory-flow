import type { FactoryNode, Recipe, ResourceAmount, ResourceGroupChoice, ResourceKind } from "./types";
import { isOreDictionaryResource } from "./resources";

/**
 * The recipe's input amount, restated in the units of the substitute actually
 * being wired in.
 *
 * Substitutes within one kind are not always one for one: a slot wanting 72 L
 * of soldering alloy wants 144 L of tin, and the alternative's ratio says so.
 * Ore dictionary members carry 1 and so leave the amount exactly as it was.
 *
 * Kinds never mix (an item satisfies an item slot, a fluid a fluid slot), so a
 * differing kind is a wire that should not exist; the amount is left alone
 * rather than inventing a ratio.
 */
export function inputOverrideAmount(
  input: Pick<ResourceAmount, "kind" | "id" | "displayName" | "amount" | "alternatives">,
  targetKind: ResourceKind,
  alternative?: { amount?: number; kind?: ResourceKind },
): number {
  if (input.kind !== targetKind) {
    return input.amount;
  }

  const perUnit = alternative?.amount;
  const hasRatio = perUnit !== undefined && Number.isFinite(perUnit) && perUnit > 0;
  return hasRatio && alternative?.kind === targetKind ? input.amount * perUnit : input.amount;
}

export function applyRecipeInputOverrides(
  recipe: Recipe,
  node: Pick<FactoryNode, "recipeInputOverrides">,
  choices?: Record<string, ResourceGroupChoice>,
): Recipe {
  let changed = false;
  const inputs = recipe.inputs.map((input, index) => {
    const override = node.recipeInputOverrides?.[String(index)];
    if (override) {
      // Legacy category wires saved the group itself as a choice, hiding its members.
      if (isOreDictionaryResource(input) && override.kind === input.kind && override.id === input.id) {
        return input;
      }
      changed = true;
      return {
        ...input,
        ...override,
        amount: override.amount ?? input.amount,
        optional: input.optional,
        consumed: input.consumed,
        neiSlot: input.neiSlot,
        // A concrete pick locks the slot: no group, no fallback.
        accepted: undefined,
        groupId: undefined,
        alternatives: undefined,
      };
    }

    // Plan-level default for a tag, applied when the node itself did not
    // pin a member. The recipe runs on the chosen member; the slot keeps
    // `accepted` so the UI can still offer the other members.
    const choice = input.groupId ? choices?.[input.groupId] : undefined;
    if (!choice || choice.kind !== input.kind) {
      return input;
    }
    const member = input.accepted?.find((entry) => entry.id === choice.id);
    if (!member) {
      return input;
    }
    changed = true;
    const perUnit = member.perUnit ?? 1;
    return {
      ...input,
      id: member.id,
      displayName: member.displayName ?? input.displayName,
      iconPath: member.iconPath ?? input.iconPath,
      iconAtlas: member.iconAtlas ?? input.iconAtlas,
      dominantColor: member.dominantColor ?? input.dominantColor,
      modId: member.modId ?? input.modId,
      amount: perUnit > 0 && Number.isFinite(perUnit) ? input.amount * perUnit : input.amount,
      accepted: input.accepted,
      groupId: input.groupId,
    };
  });

  return changed ? { ...recipe, inputs } : recipe;
}

/**
 * Preferred name for the boundary where a recipe's ingredients are resolved to
 * concrete resources. `applyRecipeInputOverrides` is kept as the entry point
 * the call sites already use; this alias documents the intended contract.
 */
export const resolveRecipeIngredients = applyRecipeInputOverrides;
