import { BOARD_GRID } from "@/lib/board-grid";
import { getNodeMachineBuildCount } from "@/lib/model/passive-production";
import { makeResourceKey } from "@/lib/model/resources";
import type {
  FactoryPocket,
  FactoryProject,
  ResourceAmount,
  ResourceBalance,
  ThroughputResult,
} from "@/lib/model/types";

/**
 * What a MINIMIZED board says about itself.
 *
 * A minimized board is a SUMMARY, not a machine: you cannot wire to it, it
 * has no ports, and it makes no claim about being fed. It reports two
 * things - what is inside (machines, cards, power) and what crosses its
 * border right now - and both come straight out of the plan-wide solve.
 *
 * That is the whole design, and it is deliberately smaller than what came
 * before. The card used to run its own SCOPED solve over the members with
 * the outside world unhooked, and then wear the result as input and output
 * ports. It read like a machine and lied like one: a board holding its own
 * source was told it was starving, because the scoped solve cut the source's
 * wires; a board exporting a byproduct was told it was clogged. Every one of
 * those verdicts was about a factory that does not exist - the members are
 * ordinary cards in the flat graph, and the real solver has been simulating
 * them, with their real supply, all along.
 */

/** One resource crossing a minimized board's border, in one direction. */
export interface PocketCrossing {
  key: string;
  kind: ResourceBalance["kind"];
  resourceId: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  /** What is really moving, summed over the wires or over the machines. */
  ratePerSecond: number;
  /** How many wires carry it. Zero on a need or an offer: those are not wires. */
  wireCount: number;
}

const RATE_EPSILON = 1e-6;

export interface PocketSummary {
  /**
   * What the contents ASK FOR that nothing inside makes: the board read as
   * a little factory, wires ignored. Red, like the plan's own Inputs.
   */
  needs: PocketCrossing[];
  /**
   * What the contents MAKE that nothing inside drinks. Green, like the
   * plan's own Outputs.
   */
  offers: PocketCrossing[];
  /** Resources arriving from outside on a wire, busiest first. */
  incoming: PocketCrossing[];
  /** Resources leaving for outside on a wire, busiest first. */
  outgoing: PocketCrossing[];
  /** Machines inside, nested boards included. */
  machineCount: number;
  /** Cards inside, nested boards included. */
  memberCount: number;
  /** What those machines are drawing at the speed they are running. */
  euPerTick: number;
}

/*
 * No cap. A board with forty crossings draws forty lines and stands
 * forty lines tall: a summary that hides half of itself behind "and 12
 * more" is not a summary, and the card is read at whatever zoom the
 * board is read at anyway.
 */

/** The four lists a minimized card stacks, by length. */
export interface PocketCardLines {
  needs: number;
  offers: number;
  incoming: number;
  outgoing: number;
}

/** Cells one two-column section costs, its label row included; 0 when empty. */
export function sectionCells(left: number, right: number): number {
  const rows = Math.max(left, right);
  return rows === 0 ? 0 : 1 + 2 * rows;
}

/**
 * How tall a minimized card stands, from its list lengths alone.
 *
 * The card and the auto-arranger both call this, so the layout can size a
 * minimized board before it has ever been measured on screen: head row,
 * the board's own needs and offers, what crosses its border, and the stat
 * footer.
 */
export function pocketCardHeight(lines: PocketCardLines): number {
  const balance = sectionCells(lines.needs, lines.offers);
  const crossings = sectionCells(lines.incoming, lines.outgoing);
  // A rule between the two, when there are two: they answer different
  // questions and must not read as one long list.
  const rule = balance > 0 && crossings > 0 ? 1 : 0;
  const body = balance + rule + crossings;
  // A board with nothing to say still gets a line saying so.
  return BOARD_GRID * (2 + (body === 0 ? 2 : body) + 2);
}

/** Every board nested under `pocketId`, itself included. */
function pocketFamily(allPockets: FactoryPocket[], pocketId: string): Set<string> {
  const family = new Set<string>([pocketId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of allPockets) {
      if (
        entry.parentPocketId !== undefined &&
        family.has(entry.parentPocketId) &&
        !family.has(entry.id)
      ) {
        family.add(entry.id);
        grew = true;
      }
    }
  }
  return family;
}

/** The cards living inside a board, nested boards included. */
function pocketMemberIds(project: FactoryProject, pocketId: string): Set<string> {
  const family = pocketFamily(project.pockets ?? [], pocketId);
  const members = new Set<string>();
  for (const node of project.nodes) {
    if (node.pocketId !== undefined && family.has(node.pocketId)) {
      members.add(node.id);
    }
  }
  for (const storage of project.storages ?? []) {
    if (storage.pocketId !== undefined && family.has(storage.pocketId)) {
      members.add(storage.id);
    }
  }
  return members;
}

/**
 * How many distinct resources cross a board's border each way.
 *
 * Structural: no solve, no rates. The auto-arranger sizes a minimized card
 * with this before any of it is on screen, and the card draws exactly this
 * many rows, so the two agree without one having to wait for the other.
 */
export function countPocketCrossings(
  project: FactoryProject,
  pocketId: string,
): PocketCardLines {
  const members = pocketMemberIds(project, pocketId);
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const edge of project.edges) {
    const sourceInside = members.has(edge.source);
    const targetInside = members.has(edge.target);
    if (sourceInside === targetInside) {
      continue;
    }
    (targetInside ? incoming : outgoing).add(`${edge.resourceKind}:${edge.resourceId}`);
  }
  const balance = computeBoardBalance(project, members, new Map(), undefined);
  return {
    needs: balance.needs.length,
    offers: balance.offers.length,
    incoming: incoming.size,
    outgoing: outgoing.size,
  };
}

/**
 * What a board's CONTENTS want and what they make, wires ignored.
 *
 * Netting is the whole point: a board whose own mine feeds its own macerator
 * asks the world for no ore, because the ore never leaves the family. What
 * survives the netting is what the board would need brought in and what it
 * would have to give away - the question the right-hand panel answers for the
 * whole plan, asked of one board.
 *
 * Rates are FULL SPEED - what the board would move with everything fed -
 * because a stalled board still needs what it is missing. What is really
 * moving is the other half of the card, the border crossings. With no solve
 * in hand the recipe amounts stand in: the arranger only needs the number of
 * lines, and the signs come out the same in every ordinary case.
 *
 * Drawers are deliberately not counted. A drawer inside is a bank, not a
 * source or a sink, exactly as the plan's own panel treats one.
 */
function computeBoardBalance(
  project: FactoryProject,
  memberIds: ReadonlySet<string>,
  icons: Map<string, ResourceIconMeta>,
  result: ThroughputResult | undefined,
): { needs: PocketCrossing[]; offers: PocketCrossing[] } {
  const net = new Map<
    string,
    { kind: ResourceBalance["kind"]; resourceId: string; net: number }
  >();
  const add = (kind: ResourceBalance["kind"], resourceId: string, perSecond: number) => {
    const key = makeResourceKey(kind, resourceId);
    const entry = net.get(key);
    if (entry) {
      entry.net += perSecond;
    } else {
      net.set(key, { kind, resourceId, net: perSecond });
    }
  };

  for (const node of project.nodes) {
    if (!memberIds.has(node.id)) {
      continue;
    }
    const nodeResult = result?.nodes[node.id];
    if (nodeResult) {
      // FULL SPEED here, deliberately, unlike everything else on this card.
      // This list answers "what does this board need to run", which is a
      // property of what is built, not of how it happens to be doing right
      // now. Scaling by utilization would erase the needs of a board that is
      // stalled BECAUSE those needs are unmet - the one board that most
      // needs a red line.
      for (const flow of Object.values(nodeResult.outputs)) {
        add(flow.kind, flow.resourceId, flow.amountPerSecond);
      }
      for (const flow of Object.values(nodeResult.inputs)) {
        add(flow.kind, flow.resourceId, -flow.amountPerSecond);
      }
      continue;
    }
    // No solve: the recipe's own amounts, which is enough for the signs and
    // the number of lines.
    const recipe = project.recipes.find((entry) => entry.id === node.recipeId);
    if (!recipe) {
      continue;
    }
    for (const output of recipe.outputs) {
      add(output.kind, output.id, output.amount * node.machineCount);
    }
    for (const input of recipe.inputs) {
      add(input.kind, input.id, -input.amount * node.machineCount);
    }
  }

  const line = (
    kind: ResourceBalance["kind"],
    resourceId: string,
    ratePerSecond: number,
  ): PocketCrossing => {
    const key = makeResourceKey(kind, resourceId);
    const icon = icons.get(key);
    return {
      key,
      kind,
      resourceId,
      displayName: icon?.displayName,
      iconPath: icon?.iconPath,
      iconAtlas: icon?.iconAtlas,
      dominantColor: icon?.dominantColor,
      ratePerSecond,
      wireCount: 0,
    };
  };

  const needs = new Map<string, PocketCrossing>();
  const offers = new Map<string, PocketCrossing>();
  for (const entry of net.values()) {
    const key = makeResourceKey(entry.kind, entry.resourceId);
    if (entry.net < -RATE_EPSILON) {
      needs.set(key, line(entry.kind, entry.resourceId, -entry.net));
    } else if (entry.net > RATE_EPSILON) {
      offers.set(key, line(entry.kind, entry.resourceId, entry.net));
    }
  }
  return { needs: sortCrossings(needs), offers: sortCrossings(offers) };
}

export function computePocketSummaries(
  project: FactoryProject,
  pockets: FactoryPocket[],
  result?: ThroughputResult,
): Map<string, PocketSummary> {
  const summaries = new Map<string, PocketSummary>();
  if (pockets.length === 0) {
    return summaries;
  }

  const icons = buildResourceIconLookup(project);
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));

  for (const pocket of pockets) {
    const memberIds = pocketMemberIds(project, pocket.id);
    const incoming = new Map<string, PocketCrossing>();
    const outgoing = new Map<string, PocketCrossing>();

    for (const edge of project.edges) {
      const sourceInside = memberIds.has(edge.source);
      const targetInside = memberIds.has(edge.target);
      if (sourceInside === targetInside) {
        continue;
      }
      const side = targetInside ? incoming : outgoing;
      const key = `${edge.resourceKind}:${edge.resourceId}`;
      // Several wires carrying one resource across one border are ONE line
      // on the card, exactly as they are one drawn wire on the board.
      const existing = side.get(key);
      const rate = result?.edges[edge.id]?.transferredPerSecond ?? 0;
      if (existing) {
        existing.ratePerSecond += rate;
        existing.wireCount += 1;
        continue;
      }
      const icon = icons.get(key);
      side.set(key, {
        key,
        kind: edge.resourceKind,
        resourceId: edge.resourceId,
        displayName: icon?.displayName ?? edge.label,
        iconPath: icon?.iconPath,
        iconAtlas: icon?.iconAtlas,
        dominantColor: icon?.dominantColor,
        ratePerSecond: rate,
        wireCount: 1,
      });
    }

    let machineCount = 0;
    let euPerTick = 0;
    for (const node of project.nodes) {
      if (!memberIds.has(node.id)) {
        continue;
      }
      machineCount += getNodeMachineBuildCount(recipesById.get(node.recipeId), node);
      const nodeResult = result?.nodes[node.id];
      if (nodeResult) {
        // Solver figures are FULL SPEED; what a board is drawing is what its
        // machines are actually running at.
        euPerTick += nodeResult.euT * Math.min(Math.max(nodeResult.utilization ?? 0, 0), 1);
      }
    }

    const balance = computeBoardBalance(project, memberIds, icons, result);
    summaries.set(pocket.id, {
      needs: balance.needs,
      offers: balance.offers,
      incoming: sortCrossings(incoming),
      outgoing: sortCrossings(outgoing),
      machineCount,
      memberCount: memberIds.size,
      euPerTick,
    });
  }

  return summaries;
}

/** Busiest first, then by name, so the card's order is stable and useful. */
function sortCrossings(crossings: Map<string, PocketCrossing>): PocketCrossing[] {
  return [...crossings.values()].sort((left, right) => {
    if (right.ratePerSecond !== left.ratePerSecond) {
      return right.ratePerSecond - left.ratePerSecond;
    }
    return (left.displayName ?? left.resourceId).localeCompare(
      right.displayName ?? right.resourceId,
    );
  });
}

type ResourceIconMeta = Pick<
  ResourceAmount,
  "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function buildResourceIconLookup(project: FactoryProject): Map<string, ResourceIconMeta> {
  const icons = new Map<string, ResourceIconMeta>();
  const add = (resource: Pick<ResourceAmount, "kind" | "id"> & ResourceIconMeta) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = icons.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) {
      icons.set(key, resource);
    }
  };

  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      add(resource);
    }
  }
  for (const storage of project.storages ?? []) {
    add({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }
  return icons;
}
