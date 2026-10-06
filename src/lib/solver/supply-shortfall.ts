import type { FactoryProject, ResourceFlow, ResourceKey, ThroughputResult } from "../model/types";
import { isRecipeInputConsumed, makeResourceKey, resourceMatchesInput } from "../model/resources";
import { applyRecipeInputOverrides } from "../model/recipe-input-overrides";
import { splitSectionHandleId } from "../model/shared-machine";
import { getEdgeTargetDemandKey } from "./equilibrium";
import { getPoolProject } from "./pool-mode";

const RATE_EPSILON = 1e-6;
const RELATIVE_EPSILON = 1e-5;

export interface InputSupplyShortfall {
  nodeId: string;
  resourceKey: ResourceKey;
  kind: ResourceFlow["kind"];
  resourceId: string;
  displayName: string;
  requiredPerSecond: number;
  suppliedPerSecond: number;
  deficitPerSecond: number;
}

export interface SupplyShortfallResult {
  /** Only resources with a material shortfall are listed. */
  byNode: Record<string, InputSupplyShortfall[]>;
  /** Input deficit apportioned over the incoming edges using their solver asks. */
  byEdge: Record<string, number>;
}

/**
 * Compare each enabled node's configured input rates with the actual flow on
 * its incoming wires. Edge transfers already include the solver's fair split,
 * storage relays, passive production and any upstream throttling, so summing
 * them neither duplicates a shared output nor needs a second propagation pass.
 */
export function calculateSupplyShortfalls(
  project: FactoryProject,
  result: ThroughputResult,
): SupplyShortfallResult {
  const graph = getPoolProject(project);
  const incomingByNode = new Map<string, typeof graph.edges>();
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const recipesById = new Map(graph.recipes.map((recipe) => [recipe.id, recipe]));
  for (const edge of graph.edges) {
    const incoming = incomingByNode.get(edge.target);
    if (incoming) incoming.push(edge);
    else incomingByNode.set(edge.target, [edge]);
  }

  const byNode: SupplyShortfallResult["byNode"] = {};
  const byEdge: SupplyShortfallResult["byEdge"] = {};
  for (const node of graph.nodes) {
    const nodeResult = result.nodes[node.id];
    if (!node.enabled || !nodeResult?.enabled) continue;

    const shortfalls: InputSupplyShortfall[] = [];
    for (const input of Object.values(nodeResult.inputs)) {
      if (input.amountPerSecond <= RATE_EPSILON) continue;
      const incoming = (incomingByNode.get(node.id) ?? []).filter(
        (edge) => targetInputKey(graph, edge, nodesById, recipesById) === input.key,
      );
      const suppliedPerSecond = incoming.reduce(
        (sum, edge) =>
          sum + inputRateForEdge(edge, result.edges[edge.id]?.transferredPerSecond ?? 0),
        0,
      );
      const rawDeficit = Math.max(0, input.amountPerSecond - suppliedPerSecond);
      const tolerance = Math.max(RATE_EPSILON, input.amountPerSecond * RELATIVE_EPSILON);
      if (rawDeficit <= tolerance) continue;
      shortfalls.push({
        nodeId: node.id,
        resourceKey: input.key,
        kind: input.kind,
        resourceId: input.resourceId,
        displayName: input.displayName ?? input.resourceId,
        requiredPerSecond: input.amountPerSecond,
        suppliedPerSecond,
        deficitPerSecond: rawDeficit,
      });

      if (incoming.length === 0) continue;
      const expectedGaps = incoming.map((edge) => {
        const edgeResult = result.edges[edge.id];
        const delivered = inputRateForEdge(edge, edgeResult?.transferredPerSecond ?? 0);
        const asked = inputRateForEdge(edge, edgeResult?.nameplateDemandPerSecond ?? delivered);
        return { edgeId: edge.id, gap: Math.max(0, asked - delivered) };
      });
      const totalExpectedGap = expectedGaps.reduce((sum, entry) => sum + entry.gap, 0);
      for (const entry of expectedGaps) {
        const share =
          totalExpectedGap > RATE_EPSILON
            ? (rawDeficit * entry.gap) / totalExpectedGap
            : rawDeficit / expectedGaps.length;
        if (share > RATE_EPSILON) byEdge[entry.edgeId] = (byEdge[entry.edgeId] ?? 0) + share;
      }
    }
    if (shortfalls.length > 0) byNode[node.id] = shortfalls;
  }
  return { byNode, byEdge };
}

const signatureByProject = new WeakMap<FactoryProject, string>();
const resultByProject = new WeakMap<FactoryProject, ThroughputResult>();
const valueByProject = new WeakMap<FactoryProject, SupplyShortfallResult>();
let mostRecent:
  | { signature: string; result: ThroughputResult; value: SupplyShortfallResult }
  | undefined;

/**
 * Memoized UI accessor. Project identity is the fast path (node drags only
 * update React Flow's local positions); a position-free signature also lets a
 * completed move reuse the solve's shortfall report without recalculating.
 */
export function getMemoizedSupplyShortfalls(
  project: FactoryProject,
  result: ThroughputResult,
): SupplyShortfallResult {
  if (resultByProject.get(project) === result) {
    return valueByProject.get(project)!;
  }

  let signature = signatureByProject.get(project);
  if (!signature) {
    signature = projectSignature(project);
    signatureByProject.set(project, signature);
  }
  if (mostRecent?.signature === signature && mostRecent.result === result) {
    resultByProject.set(project, result);
    valueByProject.set(project, mostRecent.value);
    return mostRecent.value;
  }

  const value = calculateSupplyShortfalls(project, result);
  resultByProject.set(project, result);
  valueByProject.set(project, value);
  mostRecent = { signature, result, value };
  return value;
}

function projectSignature(project: FactoryProject): string {
  const usedRecipeIds = new Set<string>();
  for (const node of project.nodes) {
    usedRecipeIds.add(node.recipeId);
    for (const section of node.extraRecipes ?? []) usedRecipeIds.add(section.recipeId);
  }
  return JSON.stringify({
    nodes: project.nodes.map((node) => withoutNodePresentation(node)),
    storages: (project.storages ?? []).map((storage) => withoutStoragePosition(storage)),
    edges: project.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      resourceKind: edge.resourceKind,
      resourceId: edge.resourceId,
      ratePerSecond: edge.ratePerSecond,
      ratioWeight: edge.ratioWeight,
      ratioInputWeight: edge.ratioInputWeight,
      crossForm: edge.crossForm,
    })),
    recipes: project.recipes.filter((recipe) => usedRecipeIds.has(recipe.id)),
    solveMode: project.solveMode,
    poolMode: project.poolMode,
    productionGroups: project.productionGroups,
    poolResourceRules: project.poolResourceRules,
    poolCellRatios: project.poolCellRatios,
    targetRate: project.targetRate,
  });
}

function withoutNodePresentation(node: FactoryProject["nodes"][number]) {
  const { position, pocketId, colorTag, settingsCollapsed, ...calculationSettings } = node;
  void position;
  void pocketId;
  void colorTag;
  void settingsCollapsed;
  return calculationSettings;
}

function withoutStoragePosition(storage: NonNullable<FactoryProject["storages"]>[number]) {
  const { position, pocketId, colorTag, ...calculationSettings } = storage;
  void position;
  void pocketId;
  void colorTag;
  return calculationSettings;
}

function targetInputKey(
  project: FactoryProject,
  edge: FactoryProject["edges"][number],
  nodesById: ReadonlyMap<string, FactoryProject["nodes"][number]>,
  recipesById: ReadonlyMap<string, FactoryProject["recipes"][number]>,
): ResourceKey | undefined {
  const solverKey = getEdgeTargetDemandKey(project, edge);
  if (solverKey) return solverKey;

  const { handleId } = splitSectionHandleId(edge.targetHandle);
  const parts = (handleId ?? "").split(":");
  if (edge.crossForm) {
    if (
      parts[0] !== "input" ||
      !["item", "fluid", "aspect", "power"].includes(parts[1] ?? "") ||
      !parts[2]
    ) {
      return undefined;
    }
    try {
      return makeResourceKey(
        parts[1] as ResourceFlow["kind"],
        decodeURIComponent(parts.slice(2).join(":")),
      );
    } catch {
      return undefined;
    }
  }

  const node = nodesById.get(edge.target);
  const recipe = node ? recipesById.get(node.recipeId) : undefined;
  if (!node || !recipe) return undefined;
  const effectiveRecipe = applyRecipeInputOverrides(recipe, node);
  const input = effectiveRecipe.inputs.find(
    (entry) =>
      isRecipeInputConsumed(entry) &&
      resourceMatchesInput({ kind: edge.resourceKind, id: edge.resourceId }, entry),
  );
  return input
    ? makeResourceKey(input.kind, input.id)
    : makeResourceKey(edge.resourceKind, edge.resourceId);
}

function inputRateForEdge(
  edge: FactoryProject["edges"][number],
  transferredPerSecond: number,
): number {
  const ratio = edge.crossForm?.litresPerCell;
  if (!ratio || ratio <= 0 || !Number.isFinite(ratio)) return transferredPerSecond;
  const { handleId } = splitSectionHandleId(edge.targetHandle);
  const parts = (handleId ?? "").split(":");
  const targetKind = parts[0] === "input" ? parts[1] : undefined;
  if (edge.resourceKind === "item" && targetKind === "fluid") {
    return transferredPerSecond * ratio;
  }
  if (edge.resourceKind === "fluid" && targetKind === "item") {
    return transferredPerSecond / ratio;
  }
  return transferredPerSecond;
}
