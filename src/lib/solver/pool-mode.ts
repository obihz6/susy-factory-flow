import {
  getFilledCellFluidEquivalent,
  isFluidEquivalentToFilledCell,
  isRecipeInputConsumed,
  makeResourceKey,
} from "../model/resources";
import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { applyMachineHandlerToRecipe } from "../model/recipe-rules";
import { expandSharedMachines, inheritSharedMachineExpansion } from "../model/shared-machine";
import { expandHatchSupplies } from "./hatch-supply";
import { poolSideOf } from "../model/storage-role";
import type {
  FactoryProject,
  FactoryStorage,
  ResourceAmount,
  ResourceKey,
  ResourceKind,
} from "../model/types";
import { getRuntimeCalculationOutputs } from "./runtime-calculation";

/**
 * POOL MODE: one shared pool per resource, no wires needed.
 *
 * The board is read as a bill of machines rather than a drawing: whatever
 * any machine makes goes into its resource's pool, whatever any machine
 * needs comes out of it, and the surplus banks. The pool is realised as
 * ordinary drawers and ordinary wires inside the solve, so every rule the
 * books already have - conservation, fairness, recycle-before-import,
 * banking - applies unchanged. Nothing here is new physics.
 *
 * Per resource key, exactly one hidden drawer (`pool:<key>`):
 *
 * - every enabled machine OUTPUT of that resource wires INTO it, and every
 *   consumed machine INPUT wires OUT of it. The wires the player drew are
 *   DROPPED (Jack, 2026-09-05): they mean nothing in this mode, the board
 *   fades them out, and they come back untouched when the mode goes off;
 * - a player's SOURCE drawer of that resource wires into it too: the
 *   plan's declared import. A drawer's side is `poolSide` when set, else
 *   what its (now ignored) wires said it was for - see `poolSideOf`;
 * - a player's DRAIN drawer wires out of it: the plan's declared product,
 *   byproduct or trash.
 *
 * Roles then fall out of the wiring the way they do everywhere else. A pool
 * with feeders and takers is an overflow BUFFER, which passes on what its
 * takers pull and banks the rest (the visible +N/s surplus). A pool with
 * feeders only is a PRODUCT drain: what the plan puts out, the free
 * outputs rule for that one resource. A pool with takers and no feeder is
 * a SOURCE: the plan IMPORTS that resource, and the books list it under
 * INPUTS at the rate its takers drink. Pool mode is the deeper solve mode
 * (it needs solve mode on): you pin product amounts or machine counts and
 * the plan does the rest - counts, imports, outputs, wiring.
 *
 * The hidden drawers and wires never reach the board. They ride the solve
 * result (edge and storage figures keyed by their ids) so the cards' rails
 * can read the pool's answer, and every diagnosis that walks the graph is
 * handed this expansion instead of the drawn one.
 */
export const POOL_STORAGE_PREFIX = "pool:";
export const POOL_EDGE_PREFIX = "pool-edge:";

export function isPoolStorageId(id: string): boolean {
  return id.startsWith(POOL_STORAGE_PREFIX);
}

export function isPoolEdgeId(id: string): boolean {
  return id.startsWith(POOL_EDGE_PREFIX);
}

interface PoolExpansion {
  project: FactoryProject;
  hiddenStorageIds: string[];
  hiddenEdgeIds: string[];
  /** The cell-fluid bridge tanks: weightless in solve mode, off the board. */
  hiddenNodeIds: string[];
}

/**
 * Every filled-cell item and fluid the plan's machines name in BOTH forms,
 * matched the way the search does (`isFluidEquivalentToFilledCell`: an
 * alternatives entry first, then the cell's name). What the ratio fetch
 * asks the Canner about, and what the expansion bridges once it knows.
 */
export function listPoolCellPairs(
  project: FactoryProject,
): Array<{ cellId: string; fluidId: string }> {
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const cells = new Map<string, ResourceAmount>();
  const fluids = new Map<string, ResourceAmount>();
  for (const node of project.nodes) {
    if (node.enabled === false) {
      continue;
    }
    const recipe = recipesById.get(node.recipeId);
    if (!recipe) {
      continue;
    }
    const nodeRecipe = applyRecipeInputOverrides(recipe, node);
    const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
    const slots = [
      ...nodeRecipe.inputs.filter((input) => isRecipeInputConsumed(input)),
      ...(getRuntimeCalculationOutputs(effectiveRecipe, node) ?? effectiveRecipe.outputs),
    ];
    for (const slot of slots) {
      if (slot.kind === "fluid") {
        fluids.set(slot.id, slot);
      } else if (slot.kind === "item" && getFilledCellFluidEquivalent(slot)) {
        cells.set(slot.id, slot);
      }
    }
  }
  const pairs: Array<{ cellId: string; fluidId: string }> = [];
  for (const [cellId, cell] of [...cells].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const [fluidId, fluid] of [...fluids].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (isFluidEquivalentToFilledCell(fluid, cell)) {
        pairs.push({ cellId, fluidId });
        break;
      }
    }
  }
  return pairs;
}

const expansionCache = new WeakMap<FactoryProject, PoolExpansion>();

/** The graph the solve and the diagnoses read: expanded in pool mode, the plan itself otherwise. */
export function getPoolProject(project: FactoryProject): FactoryProject {
  // Shared machines expand first (one hidden node per recipe section), so
  // the pool and every diagnosis see the same graph the solve ran on.
  const expanded = expandSharedMachines(project);
  if (!expanded.poolMode) return expandHatchSupplies(expanded);
  const pool = expandPool(expanded);
  const supplied = expandHatchSupplies(pool.project);
  // Later diagnoses/solves may receive this graph again. Preserve the pool's
  // identity and hidden helper IDs rather than pooling the private sources.
  expansionCache.set(supplied, { ...pool, project: supplied });
  return supplied;
}

export function expandPool(project: FactoryProject): PoolExpansion {
  if (!project.poolMode) {
    return { project, hiddenStorageIds: [], hiddenEdgeIds: [], hiddenNodeIds: [] };
  }
  const cached = expansionCache.get(project);
  if (cached) {
    return cached;
  }

  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const wiredIn = new Set<string>();
  const wiredOut = new Set<string>();
  for (const edge of project.edges) {
    wiredIn.add(edge.target);
    wiredOut.add(edge.source);
  }

  interface PoolSide {
    kind: ResourceKind;
    resourceId: string;
    feeders: Array<{ id: string; storage: boolean }>;
    takers: Array<{ id: string; storage: boolean }>;
  }
  const pools = new Map<ResourceKey, PoolSide>();
  const poolFor = (kind: ResourceKind, resourceId: string): PoolSide => {
    const key = makeResourceKey(kind, resourceId);
    let pool = pools.get(key);
    if (!pool) {
      pool = { kind, resourceId, feeders: [], takers: [] };
      pools.set(key, pool);
    }
    return pool;
  };

  for (const node of project.nodes) {
    if (node.enabled === false) {
      continue;
    }
    const recipe = recipesById.get(node.recipeId);
    if (!recipe) {
      continue;
    }
    // The node's REAL ports (concrete oredict picks, handler and runtime
    // variants), exactly as closeBoundaries reads them: a pool wire on a
    // port the solve does not have is an edge the solve drops.
    const nodeRecipe = applyRecipeInputOverrides(recipe, node);
    const effectiveRecipe = applyMachineHandlerToRecipe(nodeRecipe, node);
    const outputs = getRuntimeCalculationOutputs(effectiveRecipe, node) ?? effectiveRecipe.outputs;
    const seenIn = new Set<ResourceKey>();
    for (const input of nodeRecipe.inputs) {
      if (!isRecipeInputConsumed(input) || (input.amount ?? 0) <= 0) {
        continue;
      }
      const key = makeResourceKey(input.kind, input.id);
      if (seenIn.has(key)) {
        continue;
      }
      seenIn.add(key);
      poolFor(input.kind, input.id).takers.push({ id: node.id, storage: false });
    }
    const seenOut = new Set<ResourceKey>();
    for (const output of outputs) {
      // EU pools like anything else (a generator's EU port feeds it, an EU
      // drawer or a machine's EU port drinks from it) - the only special
      // rule is at pool creation below: unbanked power dissipates in game,
      // so an EU pool exists only when something both feeds and drinks it.
      if ((output.amount ?? 0) <= 0) {
        continue;
      }
      const key = makeResourceKey(output.kind, output.id);
      if (seenOut.has(key)) {
        continue;
      }
      seenOut.add(key);
      poolFor(output.kind, output.id).feeders.push({ id: node.id, storage: false });
    }
  }

  for (const storage of project.storages ?? []) {
    // WIRES DO NOT EXIST in pool mode, but the ones drawn before the switch
    // still say what a drawer was for (poolSideOf): fed only, a product;
    // drawn only, a source. A declared side wins; a buffer has no side.
    const side = poolSideOf(storage, wiredIn.has(storage.id), wiredOut.has(storage.id));
    if (side === "source") {
      poolFor(storage.kind, storage.resourceId).feeders.push({ id: storage.id, storage: true });
    } else if (side === "drain") {
      poolFor(storage.kind, storage.resourceId).takers.push({ id: storage.id, storage: true });
    }
  }

  const storages: FactoryStorage[] = [...(project.storages ?? [])];
  const recipes = [...project.recipes];
  const nodes = [...project.nodes];
  // The drawn wires are dropped whole: the pool is the only carrier here,
  // and a wire kept beside it would be a second route saying the same thing.
  const edges: FactoryProject["edges"] = [];
  const hiddenStorageIds: string[] = [];
  const hiddenEdgeIds: string[] = [];
  const hiddenNodeIds: string[] = [];

  // CELLS AND FLUIDS. The pool never crosses kinds on its own, exactly as a
  // wire never does; loose cell wires is forced ON here and the bridge is
  // the same hidden free Tank that rule runs a wire through: one node per
  // direction per pair, zero EU, one tick, a machine count high enough that
  // only its neighbours can bind, converting at the Canner's litres-per-
  // cell stored on the plan (`poolCellRatios`, never guessed - a pair with
  // no ratio is not bridged). The tanks are machines to the pool like any
  // other: they feed and drink through it, so the LP picks the direction
  // the board needs and leaves the other idle. Weightless in solve mode.
  for (const pair of listPoolCellPairs(project)) {
    const litresPerCell = project.poolCellRatios?.[pair.cellId];
    if (!litresPerCell || litresPerCell <= 0) {
      continue;
    }
    // Only from a side something REAL feeds. A tank feeding a pool would
    // otherwise stop that pool reading as an import, and two tanks feeding
    // each other's pools would leave a resource nobody makes in either form
    // starving instead of imported.
    const cellFed = (pools.get(makeResourceKey("item", pair.cellId))?.feeders.length ?? 0) > 0;
    const fluidFed = (pools.get(makeResourceKey("fluid", pair.fluidId))?.feeders.length ?? 0) > 0;
    const directions: Array<"empty" | "fill"> = [
      ...(cellFed ? (["empty"] as const) : []),
      ...(fluidFed ? (["fill"] as const) : []),
    ];
    for (const direction of directions) {
      const cellToFluid = direction === "empty";
      const recipeId = `pool-tank-recipe:${direction}:${pair.cellId}`;
      const nodeId = `pool-tank:${direction}:${pair.cellId}`;
      recipes.push({
        id: recipeId,
        name: `Tank: ${pair.fluidId}`,
        kind: "custom",
        category: "crossform-tank",
        machineType: "Tank",
        minimumTier: "NONE",
        durationTicks: 1,
        eut: 0,
        inputs: [
          cellToFluid
            ? { kind: "item", id: pair.cellId, amount: 1 }
            : { kind: "fluid", id: pair.fluidId, amount: litresPerCell },
        ],
        outputs: [
          cellToFluid
            ? { kind: "fluid", id: pair.fluidId, amount: litresPerCell }
            : { kind: "item", id: pair.cellId, amount: 1 },
        ],
        source: { recipeMap: "crossform-tank" },
      });
      nodes.push({
        id: nodeId,
        recipeId,
        machineCount: 1_000,
        parallel: 1,
        overclockTier: "NONE",
        enabled: true,
        position: { x: 0, y: 0 },
      });
      hiddenNodeIds.push(nodeId);
      if (cellToFluid) {
        poolFor("item", pair.cellId).takers.push({ id: nodeId, storage: false });
        poolFor("fluid", pair.fluidId).feeders.push({ id: nodeId, storage: false });
      } else {
        poolFor("fluid", pair.fluidId).takers.push({ id: nodeId, storage: false });
        poolFor("item", pair.cellId).feeders.push({ id: nodeId, storage: false });
      }
    }
  }

  const keys = [...pools.keys()].sort();
  for (const key of keys) {
    const pool = pools.get(key)!;
    // A pool nobody feeds has takers only, so it is a SOURCE: the plan
    // imports that resource, and the books list it under INPUTS at the
    // rate the takers drink. That is the deeper-solve reading (Jack,
    // 2026-09-05): you pin amounts and counts, the plan does the rest.
    // EU is the exception both ways: the plan never imports power from
    // nowhere (a generator has to be on the board), and unbanked power
    // dissipates in game, so an EU pool with nobody drinking is no product.
    if (pool.kind === "power" && (pool.feeders.length === 0 || pool.takers.length === 0)) {
      continue;
    }
    let poolId = `${POOL_STORAGE_PREFIX}${key}`;
    while (storageIds.has(poolId)) {
      poolId = `${poolId}:`;
    }
    storageIds.add(poolId);
    hiddenStorageIds.push(poolId);
    // With takers this is an overflow buffer; without, a PRODUCT drain:
    // what the plan puts out. Product rather than byproduct on purpose -
    // a byproduct asks for nothing, and a machine whose only outlet asks
    // for nothing reads "on demand" when it is really short of an input.
    storages.push({
      id: poolId,
      kind: pool.kind,
      resourceId: pool.resourceId,
      position: { x: 0, y: 0 },
    });
    for (const feeder of pool.feeders) {
      const id = `${POOL_EDGE_PREFIX}in:${feeder.id}:${key}`;
      hiddenEdgeIds.push(id);
      edges.push({
        id,
        source: feeder.id,
        target: poolId,
        resourceKind: pool.kind,
        resourceId: pool.resourceId,
      });
    }
    for (const taker of pool.takers) {
      const id = `${POOL_EDGE_PREFIX}out:${taker.id}:${key}`;
      hiddenEdgeIds.push(id);
      edges.push({
        id,
        source: poolId,
        target: taker.id,
        resourceKind: pool.kind,
        resourceId: pool.resourceId,
      });
    }
  }

  const expansion: PoolExpansion = {
    project: { ...project, recipes, nodes, storages, edges },
    hiddenStorageIds,
    hiddenEdgeIds,
    hiddenNodeIds,
  };
  expansionCache.set(project, expansion);
  // The expanded plan still says poolMode, and it is what the solver hands
  // on to every diagnosis: asking to expand it again must answer with
  // itself, never pool the pools.
  expansionCache.set(expansion.project, expansion);
  inheritSharedMachineExpansion(project, expansion.project);
  return expansion;
}
