import { isRecipeInputConsumed, makeResourceKey } from "../model/resources";
import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { applyMachineHandlerToRecipe } from "../model/recipe-rules";
import type { FactoryProject, FactoryStorage, ResourceKey } from "../model/types";
import { getRuntimeCalculationOutputs } from "./runtime-calculation";

/**
 * How far each side of the boundary is closed.
 *
 * - `none`  leave it alone; a slot short of stock starves, a surplus clogs.
 * - `bare`  fill in only the slots with NO wire on them. The declared
 *           boundary wins, which is what a lifted-out selection needs.
 * - `all`   a drawer on every slot, wired or not, so a half-fed input tops up
 *           and a surplus output spills (what wiring a source onto every
 *           input would do).
 */
export type BoundaryScope = "none" | "bare" | "all";

export interface CloseBoundariesOptions {
  inputs?: BoundaryScope;
  outputs?: BoundaryScope;
}

/**
 * Close a plan's boundary: a SOURCE drawer on every ingredient nobody makes,
 * a DRAIN drawer on every product nobody takes.
 *
 * A board does NOT do this by default: declaring the boundary is the
 * player's job, and a card with a bare slot reads UNWIRED until they do. It
 * runs for:
 * - free inputs/outputs setup rules in calculateThroughput, at scope `all`
 *   (getSetupRules currently answers every plan with both off);
 * - `calculateSelectionFlow`, which solves a selection "as if it were the
 *   whole board": severing the wires would otherwise starve every scoped
 *   solve at the cut;
 * - solver fixtures whose subject is something else (allocation, balances,
 *   overclocks) and that assume raw materials turn up and products go away.
 *
 * The added drawers read as the plan's imports and exports in the books
 * (balances.ts reads boundary drawers), so a fed ingredient still shows as
 * something the plan NEEDS and a drained product as something it puts OUT.
 *
 * Do not use it in tests that are ABOUT the boundary: those wire their own
 * drawers, because which drawer sits where is what they check.
 */
export function closeBoundaries(
  project: FactoryProject,
  options: CloseBoundariesOptions = {},
): FactoryProject {
  const inputScope = options.inputs ?? "bare";
  const outputScope = options.outputs ?? "bare";
  if (inputScope === "none" && outputScope === "none") {
    return project;
  }
  const storages: FactoryStorage[] = [...(project.storages ?? [])];
  const edges = [...project.edges];
  const storageIds = new Set(storages.map((storage) => storage.id));

  // Every slot that already has a wire on it, keyed by node and side. Read
  // from the ORIGINAL edges: the boundary edges this adds must not count as
  // the player's wiring, or scope `all` would stop after the first slot.
  const playerWired = new Set<string>();
  for (const edge of project.edges) {
    const key = makeResourceKey(edge.resourceKind, edge.resourceId);
    playerWired.add(`${edge.target}|in|${key}`);
    playerWired.add(`${edge.source}|out|${key}`);
  }
  // What this function has already put down, so a recipe listing one resource
  // in two slots gets one drawer rather than two.
  const attached = new Set<string>();
  const needsDrawer = (nodeId: string, side: "in" | "out", key: ResourceKey) => {
    const slot = `${nodeId}|${side}|${key}`;
    if (attached.has(slot)) {
      return false;
    }
    const scope = side === "in" ? inputScope : outputScope;
    if (scope === "none") {
      return false;
    }
    if (scope === "bare" && playerWired.has(slot)) {
      return false;
    }
    attached.add(slot);
    return true;
  };

  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  // Stacked beside the machine they serve rather than piled on the origin:
  // sources off to its left, drains off to its right, which is the direction
  // the board already reads in. On grid, so the router keeps its endpoints.
  const placed = new Map<string, number>();
  const positionFor = (nodeId: string, side: "in" | "out") => {
    const anchor = nodesById.get(nodeId)?.position ?? { x: 0, y: 0 };
    const lane = `${nodeId}|${side}`;
    const index = placed.get(lane) ?? 0;
    placed.set(lane, index + 1);
    return {
      x: anchor.x + (side === "in" ? -260 : 460),
      y: anchor.y + index * 160,
    };
  };

  let seq = 0;
  const attach = (
    nodeId: string,
    side: "in" | "out",
    kind: FactoryStorage["kind"],
    resourceId: string,
  ) => {
    seq += 1;
    let id = `boundary-${side}-${seq}`;
    while (storageIds.has(id)) {
      seq += 1;
      id = `boundary-${side}-${seq}`;
    }
    storageIds.add(id);
    storages.push({ id, kind, resourceId, position: positionFor(nodeId, side) });
    edges.push({
      id: `boundary-edge-${side}-${seq}`,
      source: side === "in" ? id : nodeId,
      target: side === "in" ? nodeId : id,
      resourceKind: kind,
      resourceId,
    });
  };

  for (const node of project.nodes) {
    if (node.enabled === false) {
      continue;
    }
    const recipe = recipesById.get(node.recipeId);
    if (!recipe) {
      continue;
    }
    // The node's REAL ports, not the raw recipe's: an oredict slot pinned to
    // a concrete item consumes that item, and a handler or a runtime variant
    // can change what comes out. A drawer on a port the solve does not have
    // is an edge the solve drops (a silent starve). Only the keys matter, not
    // rates, so this can run before the solver.
    const nodeRecipe = applyRecipeInputOverrides(recipe, node, project.resourceChoices);
    const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
    const outputs = getRuntimeCalculationOutputs(effectiveRecipe, node) ?? effectiveRecipe.outputs;
    // Non-consumed inputs are not ingredients and never need a feeder.
    for (const input of nodeRecipe.inputs) {
      if (!isRecipeInputConsumed(input) || (input.amount ?? 0) <= 0) {
        continue;
      }
      const key = makeResourceKey(input.kind, input.id);
      if (needsDrawer(node.id, "in", key)) {
        attach(node.id, "in", input.kind as FactoryStorage["kind"], input.id);
      }
    }
    for (const output of outputs) {
      if ((output.amount ?? 0) <= 0) {
        continue;
      }
      const key = makeResourceKey(output.kind, output.id);
      if (needsDrawer(node.id, "out", key)) {
        attach(node.id, "out", output.kind as FactoryStorage["kind"], output.id);
      }
    }
  }

  return { ...project, storages, edges };
}
