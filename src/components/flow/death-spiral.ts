import type { FactoryProject, ThroughputResult } from "@/lib/model/types";
import { makeResourceKey } from "@/lib/model";
import { DEAD_RING_EPSILON, stronglyConnectedComponents } from "@/lib/solver/equilibrium";

/**
 * Death spirals: rings of machines that feed each other and cannot start.
 *
 * The solver already gets these right, and deliberately so. A ring that makes
 * AT LEAST as much of the looped good as it eats sustains itself - a surplus
 * ring by its own excess, an exactly-balanced ring by the balanced-ring
 * rescue in equilibrium.ts (primed once, it runs forever, so the solver
 * treats it as primed). A ring that loses even a little on every pass winds
 * down geometrically to zero, because that is exactly what would happen in
 * game. Nothing here changes a single number.
 *
 * What it changes is that the board stops keeping the reason a secret. A dead
 * ring reads as a field of 0% cards, and — worse since the verdict split —
 * each one says "blocked, the fix is upstream" while pointing at the next
 * machine round the ring. A hundred cards can chase each other forever. The
 * "follow the amber cards up and you land on a red one" promise is only true
 * for acyclic chains; this is the terminator for the cyclic case.
 *
 * The catch that makes this worth detecting at all: an UNWIRED input is
 * assumed hand-fed, so the same ring reads perfectly healthy right up until
 * you wire it closed. Then it has to source the good from itself, cannot, and
 * everything falls to zero. That transition looks like the planner breaking,
 * and it is the planner finally telling the truth.
 */

/** Below this a node has converged to a hard stop, not merely to "slow".
 * Shared with the solver's balanced-ring rescue so the badge never calls a
 * ring dead that the rescue was not offered. */
const DEAD_EPSILON = DEAD_RING_EPSILON;
const RATE_EPSILON = 1e-6;

export interface DeathSpiral {
  /** Stable id: the smallest member node id. Survives re-solves. */
  id: string;
  /** Every node in the ring, sorted, machines and pass-through buffers alike. */
  nodeIds: string[];
  /** Machine members only — what the copy counts. */
  machineIds: string[];
  /** The wires that make up the ring — both ends inside it. */
  edgeIds: string[];
  /** Display names of the goods that travel round the ring. */
  resourceNames: string[];
  /** Something outside the ring is wired into it. */
  hasExternalSource: boolean;
  /** ...but it delivers nothing, so it cannot prime the ring either. */
  externalSourceDry: boolean;
  /** The outside supplier's name, when exactly one is wired in. */
  externalSourceName?: string;
  /**
   * Outside MACHINES wired into the ring that could deliver nothing at all
   * and are themselves stopped. When any exist the ring is not dying of its
   * own losses - it is waiting on a supplier that has its own problem (an
   * unwired slot, a clog, a switch), and the story must point THERE. The
   * titanium line was the proving case: a healthy chlorine ring read
   * "dead loop" because the machine feeding it rutile dust had an unwired
   * output, and the one actionable card on the board went unmentioned.
   */
  deadFeeders: Array<{ nodeId: string; name: string; resourceName: string }>;
}

// Tarjan's algorithm lives in the solver (`stronglyConnectedComponents` in
// equilibrium.ts, shared with the balanced-ring rescue) so the badge and the
// rescue always agree on what a ring is.

export interface DeathSpiralIndex {
  /** Node id -> the spiral it is trapped in. */
  byNode: Map<string, DeathSpiral>;
  /**
   * Edge id -> the spiral it goes round. O(1), because the edge renderer asks
   * this once per edge and anything heavier there is O(edges) per frame.
   */
  byEdge: Map<string, DeathSpiral>;
  /** Every distinct spiral on the board, biggest first. */
  spirals: DeathSpiral[];
}

const EMPTY_INDEX: DeathSpiralIndex = { byNode: new Map(), byEdge: new Map(), spirals: [] };

// Keyed on object identity, like the board's other per-solve indexes: the
// solver hands out a fresh result per tick, so a stale index cannot outlive
// the numbers it was built from.
const cache = new WeakMap<
  FactoryProject,
  { result: ThroughputResult | undefined; index: DeathSpiralIndex }
>();

/**
 * Every ring on the board that has converged to a standstill.
 *
 * A ring only counts as dead when EVERY machine in it has stopped. One member
 * still turning means the loop sustains itself and there is nothing to report
 * — a surplus ring is a perfectly good build, and saying otherwise about a
 * working factory would be worse than saying nothing.
 */
export function findDeathSpirals(
  project: FactoryProject,
  result: ThroughputResult | undefined,
): DeathSpiralIndex {
  const cached = cache.get(project);
  if (cached && cached.result === result) {
    return cached.index;
  }
  if (!result) {
    return EMPTY_INDEX;
  }
  // SOLVE MODE has no death spirals: a ring at zero there means "no typed
  // amount needs this ring", not "this ring starved itself" - the diagnosis
  // describes a FIXED build's dynamics, and the build is what solve mode
  // computes. Silenced at the detector so every reader (the notice, the
  // wire tint, the verdict, the board dump) agrees.
  if (project.solveMode) {
    return EMPTY_INDEX;
  }

  const storageIds = new Set((project.storages ?? []).map((storage) => storage.id));
  const nodeById = new Map(project.nodes.map((node) => [node.id, node]));
  const recipeById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));

  // Buffers ride in the graph as pass-through hops, so a ring that runs A ->
  // tank -> B -> A is still found. A hand-stocked tank has no inbound line at
  // all, so it can never sit inside a cycle — which is the correct answer:
  // stock in a tank IS the way out of a spiral.
  const outgoing = new Map<string, string[]>();
  const graphNodes: string[] = [];
  for (const node of project.nodes) {
    graphNodes.push(node.id);
  }
  for (const id of storageIds) {
    graphNodes.push(id);
  }
  for (const edge of project.edges) {
    const bucket = outgoing.get(edge.source);
    if (bucket) {
      bucket.push(edge.target);
    } else {
      outgoing.set(edge.source, [edge.target]);
    }
  }

  const selfLooped = new Set<string>();
  for (const edge of project.edges) {
    if (edge.source === edge.target) {
      selfLooped.add(edge.source);
    }
  }

  const byNode = new Map<string, DeathSpiral>();
  const byEdge = new Map<string, DeathSpiral>();
  const spirals: DeathSpiral[] = [];

  for (const component of stronglyConnectedComponents(graphNodes, outgoing)) {
    // A ring is two or more nodes, or one node wired back into itself.
    if (component.length < 2 && !selfLooped.has(component[0]!)) {
      continue;
    }

    const members = new Set(component);
    const machineIds = component.filter((id) => !storageIds.has(id)).sort();
    if (machineIds.length === 0) {
      continue;
    }

    // Disabled machines are stopped because you stopped them; that is not a
    // spiral, and a ring containing one has an obvious explanation already.
    const anyDisabled = machineIds.some((id) => nodeById.get(id)?.enabled === false);
    if (anyDisabled) {
      continue;
    }

    // Stopped, AND stopped by capability. Both halves matter: a ring can also
    // read 0% across the board because nothing outside wants its product, and
    // that one has healthy capability, is not dying, and is fixed by wiring up
    // a consumer rather than by priming anything. Usage alone cannot tell the
    // two apart, so the test is on what the inputs would ALLOW.
    const allStarved = machineIds.every((id) => {
      const nodeResult = result.nodes[id];
      if (!nodeResult) {
        return false;
      }
      const capable = nodeResult.capableUtilization ?? 1;
      return nodeResult.utilization <= DEAD_EPSILON && capable <= DEAD_EPSILON;
    });
    if (!allStarved) {
      continue;
    }

    const resourceNames = new Set<string>();
    const edgeIds: string[] = [];
    let hasExternalSource = false;
    let externalInflow = 0;
    const externalSourceNames = new Set<string>();
    const deadFeeders: DeathSpiral["deadFeeders"] = [];
    for (const edge of project.edges) {
      const targetInside = members.has(edge.target);
      const sourceInside = members.has(edge.source);
      if (targetInside && sourceInside) {
        edgeIds.push(edge.id);
        const key = makeResourceKey(edge.resourceKind, edge.resourceId);
        const flow =
          result.nodes[edge.source]?.outputs[key as keyof (typeof result.nodes)[string]["outputs"]];
        resourceNames.add(flow?.displayName ?? edge.label ?? edge.resourceId);
        continue;
      }
      if (targetInside && !sourceInside) {
        hasExternalSource = true;
        externalInflow += result.edges[edge.id]?.transferredPerSecond ?? 0;
        const storage = (project.storages ?? []).find((entry) => entry.id === edge.source);
        if (storage) {
          externalSourceNames.add(storage.displayName ?? storage.resourceId);
        } else {
          const sourceNode = nodeById.get(edge.source);
          const recipe = sourceNode ? recipeById.get(sourceNode.recipeId) : undefined;
          const feederName = recipe?.machineType ?? recipe?.name ?? "a machine";
          externalSourceNames.add(feederName);
          // A supplier that could deliver NOTHING (capability, not desire -
          // an idle-but-able feeder shows available flow) and is itself at a
          // standstill. Only machines qualify: a source drawer is bottomless
          // and a dry buffer already tells its own story through its feeder.
          const couldDeliver = result.edges[edge.id]?.availablePerSecond ?? 0;
          const feederUtilization = result.nodes[edge.source]?.utilization ?? 0;
          if (couldDeliver <= RATE_EPSILON && feederUtilization <= DEAD_EPSILON) {
            const key = makeResourceKey(edge.resourceKind, edge.resourceId);
            const resourceName =
              result.nodes[edge.target]?.inputs[key]?.displayName ??
              result.nodes[edge.source]?.outputs[key]?.displayName ??
              edge.label ??
              edge.resourceId;
            deadFeeders.push({ nodeId: edge.source, name: feederName, resourceName });
          }
        }
      }
    }

    const spiral: DeathSpiral = {
      id: machineIds[0]!,
      nodeIds: [...component].sort(),
      machineIds,
      edgeIds,
      resourceNames: [...resourceNames].sort(),
      hasExternalSource,
      externalSourceDry: hasExternalSource && externalInflow <= RATE_EPSILON,
      externalSourceName:
        externalSourceNames.size === 1 ? [...externalSourceNames][0] : undefined,
      deadFeeders,
    };
    spirals.push(spiral);
    for (const id of component) {
      byNode.set(id, spiral);
    }
    for (const id of edgeIds) {
      byEdge.set(id, spiral);
    }
  }

  spirals.sort((left, right) => right.machineIds.length - left.machineIds.length);
  const index: DeathSpiralIndex = { byNode, byEdge, spirals };
  cache.set(project, { result, index });
  return index;
}

/**
 * The ring's story in plain words: what is happening, why, and the one thing
 * that fixes it. Deliberately says the planner is right — a player watching a
 * hundred machines fall to zero the moment they wired the last line needs to
 * hear that this is the game, not the tool.
 */
export function describeDeathSpiral(spiral: DeathSpiral): {
  title: string;
  /** One line, for the board notice. The long version lives on the cards. */
  short: string;
  what: string;
  why: string;
  fix: string;
} {
  const count = spiral.machineIds.length;
  const machines = count === 1 ? "This machine feeds itself" : `${count} machines feed each other`;
  const goods =
    spiral.resourceNames.length === 0
      ? "what they pass round"
      : spiral.resourceNames.length <= 2
        ? spiral.resourceNames.join(" and ")
        : `${spiral.resourceNames.slice(0, 2).join(", ")} and ${spiral.resourceNames.length - 2} more`;

  // A ring waiting on a stopped supplier is NOT dying of its own losses, and
  // saying "loop" first would send the player priming a ring whose real
  // problem is one ordinary card somewhere else. Name the supplier, say the
  // ring restarts on its own, and stop.
  const feeder = spiral.deadFeeders[0];
  if (feeder) {
    const others =
      spiral.deadFeeders.length > 1 ? ` (and ${spiral.deadFeeders.length - 1} more like it)` : "";
    return {
      title: "This loop is waiting on its supplier",
      short: `${count === 1 ? "A self-feeding machine" : `A ring of ${count} machines`} stopped because ${feeder.name} stopped sending ${feeder.resourceName}. Fix that machine and the ring restarts.`,
      what: `${machines} in a ring, passing ${goods} round it. The ring also needs ${feeder.resourceName} from outside, and none is arriving.`,
      why: `${feeder.name}${others} has stopped, so the ${feeder.resourceName} line into this ring delivers nothing. A ring only keeps itself going once material moves round it; with its top-up gone there is nothing to go round.`,
      fix: `Go to ${feeder.name}: its own card says why it stopped. Get it running and this ring comes back on its own.`,
    };
  }

  return {
    title: count === 1 ? "This loop cannot start itself" : "These machines are stuck in a loop",
    // The board notice is a nudge, not a lecture: name it, size it, and give
    // the one move. Anyone who wants the reasoning hovers a card.
    short:
      count === 1
        ? "A machine feeds itself and has stopped. Feed it from outside to start it."
        : `${count} machines feed each other in a ring and have all stopped. Feed any one of them to start it.`,
    what: `${machines} in a ring, passing ${goods} round it. Every one of them sits at 0%.`,
    why: "More leaves the ring than comes back round it, so every lap starts with less than the last one and it winds down to nothing. That happens whether the recipes lose a little each time or something taps the ring for its own use. Nothing outside puts the difference back, and a ring cannot start itself from empty.",
    fix: spiral.externalSourceDry
      ? `The only thing feeding it, ${spiral.externalSourceName ?? "its supplier"}, has stopped too. Get that running and the ring comes back with it.`
      : spiral.hasExternalSource
        ? "What feeds it does not cover the losses. Send more in, or take less out of the ring."
        : "Wire a source into any machine in the ring, or hang a stocked barrel on one. Anything that puts the shortfall back in each pass will start it.",
  };
}
