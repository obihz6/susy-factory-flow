import type {
  FactoryNode,
  FactoryProject,
  FactoryStorage,
  Recipe,
  ResourceAmount,
  ResourceKind,
} from "./types";
import { isRecipeInputConsumed, resourceMatchesInput } from "./resources";
import {
  applyRecipeInputOverrides,
} from "./recipe-input-overrides";
import { applyMachineHandlerToRecipe } from "./recipe-rules";
import { applyMachineOutputMultipliers } from "../solver/machine-effects";
import { getOverclockedRecipeStats } from "../solver/overclock";

/**
 * A pocket card is a VIEW over hidden members — the flat graph never holds an
 * edge whose endpoint is a pocket. So a wire aimed at a pocket's port has to
 * land on real member nodes, and these helpers answer the two questions that
 * takes: which resources does a pocket expose as ports, and which members
 * stand behind one port. A port fans out: wiring redstone to a pocket whose
 * two machines both drink redstone feeds both of them.
 */

/**
 * The recipe a node actually presents on the board: concrete oredict
 * overrides applied, the selected machine handler folded in, and tiered
 * output multipliers taken into account. Handle ids, port lists and
 * compatibility checks must all read THIS recipe, never the raw one
 * (see AGENTS.md on effective rendered resources).
 */
export function getEffectiveNodeRecipe(recipe: Recipe, node: FactoryNode): Recipe {
  const nodeRecipe = applyRecipeInputOverrides(recipe, node);
  const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
  const overclockedStats = getOverclockedRecipeStats(nodeRecipe, node);
  const adjustedRecipe = applyMachineOutputMultipliers(
    effectiveRecipe,
    node,
    overclockedStats.tier,
  );
  return {
    ...effectiveRecipe,
    ...adjustedRecipe,
  };
}

export function isPocketId(project: FactoryProject, id: string): boolean {
  return (project.pockets ?? []).some((pocket) => pocket.id === id);
}

/** The pocket plus every pocket nested inside it, transitively. */
function collectPocketIdsWithin(project: FactoryProject, pocketId: string): Set<string> {
  const pockets = project.pockets ?? [];
  const ids = new Set<string>([pocketId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const pocket of pockets) {
      if (
        pocket.parentPocketId !== undefined &&
        ids.has(pocket.parentPocketId) &&
        !ids.has(pocket.id)
      ) {
        ids.add(pocket.id);
        grew = true;
      }
    }
  }
  return ids;
}

export interface PocketMembers {
  nodes: FactoryNode[];
  storages: FactoryStorage[];
}

/** Every concrete card inside a pocket, nested pockets included. */
export function collectPocketMembers(project: FactoryProject, pocketId: string): PocketMembers {
  const ids = collectPocketIdsWithin(project, pocketId);
  return {
    nodes: project.nodes.filter((node) => node.pocketId !== undefined && ids.has(node.pocketId)),
    storages: (project.storages ?? []).filter(
      (storage) => storage.pocketId !== undefined && ids.has(storage.pocketId),
    ),
  };
}

/**
 * Expand a board selection through pocket membership: selecting a pocket
 * card means selecting everything inside it, transitively. Returns the
 * concrete item ids (nodes/storages/annotations) and the pocket ids.
 *
 * Every feature that acts on "what is selected" runs through here — copy,
 * blueprint capture, compact, and the selection-scoped flow panel — so a
 * pocket card always means the same thing to all of them.
 */
export function expandPocketSelection(
  project: FactoryProject,
  selectedIds: Iterable<string>,
): { itemIds: Set<string>; pocketIds: Set<string> } {
  const pockets = project.pockets ?? [];
  const selected = new Set(selectedIds);
  const pocketIds = new Set<string>();
  const queue: string[] = [];
  for (const pocket of pockets) {
    if (selected.has(pocket.id)) {
      pocketIds.add(pocket.id);
      queue.push(pocket.id);
    }
  }
  while (queue.length > 0) {
    const parentId = queue.pop();
    for (const pocket of pockets) {
      if (pocket.parentPocketId === parentId && !pocketIds.has(pocket.id)) {
        pocketIds.add(pocket.id);
        queue.push(pocket.id);
      }
    }
  }

  const itemIds = new Set<string>();
  const isMember = (item: { id: string; pocketId?: string }) =>
    selected.has(item.id) || (item.pocketId !== undefined && pocketIds.has(item.pocketId));
  for (const node of project.nodes) {
    if (isMember(node)) {
      itemIds.add(node.id);
    }
  }
  for (const storage of project.storages ?? []) {
    if (isMember(storage)) {
      itemIds.add(storage.id);
    }
  }
  for (const annotation of project.annotations ?? []) {
    if (isMember(annotation)) {
      itemIds.add(annotation.id);
    }
  }
  return { itemIds, pocketIds };
}
