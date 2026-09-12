import type { FactoryEdge, FactoryNode, FactoryNodeRecipeSection, FactoryProject, MachineHandler, Recipe } from "./types";
import { getRecipeMachineHandlers } from "./recipe-rules";

/**
 * SHARED MACHINES (Jack, 2026-09-07): one card, several recipes, one machine.
 *
 * In the game a Large Chemical Reactor fed for two reactions runs whichever
 * one its inputs allow, one at a time, so two recipes TIME-SHARE the machine.
 * The planner keeps that as one card with SECTIONS: section 0 is the card's
 * own `recipeId`, sections 1..n are `extraRecipes`. Every section keeps its
 * own slots, wires and oredict picks. The machine count, tier, power budget
 * and every config knob are the card's, shared by all of them.
 *
 * What is coupled is exactly what the game couples, and nothing more:
 *   - TIME. The solver expands each extra section into a hidden node
 *     (`expandSharedMachines`) and adds one row per card, the sum of the
 *     sections' acts at most one (equations-core.ts). A section's act IS its
 *     share of the machine's time, because its nameplate already carries the
 *     whole machine count.
 *   - NOTHING ELSE. GT5U's ProcessingLogic walks every recipe the inputs
 *     match and skips one that fails on output space or voltage, so a starved
 *     or clogged section simply hands its time to the others. Ports stay per
 *     section, verdicts stay per section.
 *
 * ADDRESSING. A section's port handles wear an `r<n>:` prefix on the ordinary
 * handle id (`sectionHandleId`), so a wire on the board says which section
 * it lands on while still naming the real card. The hidden solve node for a
 * section is `sectionNodeId(cardId, n)`; a solve result is read back per
 * section under that id. Section 0 keeps bare handles and the card's own id,
 * so an ordinary card is untouched by all of this.
 */

export type { FactoryNodeRecipeSection };

const SECTION_HANDLE_RE = /^r(\d+):(.*)$/;
const SECTION_NODE_SEPARATOR = "#r";

/** How many recipes the card's machine runs. */
export function nodeSectionCount(node: Pick<FactoryNode, "extraRecipes">): number {
  return 1 + (node.extraRecipes?.length ?? 0);
}

export function isSharedMachineNode(node: Pick<FactoryNode, "extraRecipes">): boolean {
  return (node.extraRecipes?.length ?? 0) > 0;
}

/** `r2:input:item:foo` -> section 2, `input:item:foo`. A bare handle is section 0. */
export function splitSectionHandleId(handleId: string | undefined): {
  section: number;
  handleId: string | undefined;
} {
  if (!handleId) {
    return { section: 0, handleId };
  }
  const match = SECTION_HANDLE_RE.exec(handleId);
  if (!match) {
    return { section: 0, handleId };
  }
  return { section: Number(match[1]), handleId: match[2] };
}

export function sectionHandleId(section: number, handleId: string): string {
  return section > 0 ? `r${section}:${handleId}` : handleId;
}

export function handleSection(handleId: string | undefined): number {
  return splitSectionHandleId(handleId).section;
}

/** The hidden solve node that stands for section n of a card (n >= 1). */
export function sectionNodeId(nodeId: string, section: number): string {
  return section > 0 ? `${nodeId}${SECTION_NODE_SEPARATOR}${section}` : nodeId;
}

export function parseSectionNodeId(id: string): { nodeId: string; section: number } {
  const at = id.lastIndexOf(SECTION_NODE_SEPARATOR);
  if (at <= 0) {
    return { nodeId: id, section: 0 };
  }
  const tail = id.slice(at + SECTION_NODE_SEPARATOR.length);
  if (!/^\d+$/.test(tail)) {
    return { nodeId: id, section: 0 };
  }
  return { nodeId: id.slice(0, at), section: Number(tail) };
}

export function isSectionNodeId(id: string): boolean {
  return parseSectionNodeId(id).section > 0;
}

/** The card a solve node id belongs to: itself for a card, the card for a section. */
export function sectionOwnerId(id: string): string {
  return parseSectionNodeId(id).nodeId;
}

export function getNodeSectionRecipeId(node: FactoryNode, section: number): string | undefined {
  return section === 0 ? node.recipeId : node.extraRecipes?.[section - 1]?.recipeId;
}

/**
 * The card seen as ONE section: the same machine settings, that section's
 * recipe and oredict picks, under the section's solve id. This is the node
 * the solver, the verdicts and the rails read for a section.
 */
export function sectionNodeView(node: FactoryNode, section: number): FactoryNode {
  if (section === 0) {
    return node;
  }
  const extra = node.extraRecipes?.[section - 1];
  if (!extra) {
    return node;
  }
  const { extraRecipes: _extras, solvePin: _pin, targetOutput: _target, ...rest } = node;
  void _extras;
  void _pin;
  void _target;
  return {
    ...rest,
    id: sectionNodeId(node.id, section),
    recipeId: extra.recipeId,
    recipeInputOverrides: extra.recipeInputOverrides,
  };
}

export function listNodeSections(node: FactoryNode): Array<{ section: number; node: FactoryNode }> {
  const sections = [{ section: 0, node }];
  node.extraRecipes?.forEach((_extra, index) => {
    sections.push({ section: index + 1, node: sectionNodeView(node, index + 1) });
  });
  return sections;
}

/** Every recipe id the card's machine runs, section 0 first. */
export function listNodeRecipeIds(node: FactoryNode): string[] {
  return [node.recipeId, ...(node.extraRecipes ?? []).map((extra) => extra.recipeId)];
}

/**
 * The machines that can run EVERY recipe on the card: the intersection of the
 * sections' handler lists, in section 0's order. A card with one section is
 * just that recipe's list.
 */
export function getSharedMachineHandlers(
  node: FactoryNode,
  recipesById: ReadonlyMap<string, Recipe> | ((id: string) => Recipe | undefined),
): MachineHandler[] {
  const lookup = typeof recipesById === "function" ? recipesById : (id: string) => recipesById.get(id);
  const primary = lookup(node.recipeId);
  if (!primary) {
    return [];
  }
  let handlers = getRecipeMachineHandlers(primary);
  for (const extra of node.extraRecipes ?? []) {
    const recipe = lookup(extra.recipeId);
    if (!recipe) {
      continue;
    }
    const ids = new Set(getRecipeMachineHandlers(recipe).map((handler) => handler.id));
    handlers = handlers.filter((handler) => ids.has(handler.id));
  }
  return handlers;
}

/**
 * Whether a recipe can join a card's machine: at least one machine runs both
 * it and everything already on the card. Returns the handlers they share.
 */
export function sharedHandlersWith(
  node: FactoryNode,
  recipesById: ReadonlyMap<string, Recipe> | ((id: string) => Recipe | undefined),
  recipe: Recipe,
): MachineHandler[] {
  const current = getSharedMachineHandlers(node, recipesById);
  const ids = new Set(getRecipeMachineHandlers(recipe).map((handler) => handler.id));
  return current.filter((handler) => ids.has(handler.id));
}

/**
 * The section a wire lands on at one card, read off its handle. An edge
 * with no handle is section 0, so wires from before sections existed keep
 * their meaning.
 */
export function edgeSectionAt(edge: Pick<FactoryEdge, "source" | "target" | "sourceHandle" | "targetHandle">, nodeId: string, end: "source" | "target"): number {
  if (end === "source") {
    return edge.source === nodeId ? handleSection(edge.sourceHandle) : 0;
  }
  return edge.target === nodeId ? handleSection(edge.targetHandle) : 0;
}

/** Fast check: does anything on the plan share a machine? */
export function hasSharedMachines(project: Pick<FactoryProject, "nodes">): boolean {
  return project.nodes.some(isSharedMachineNode);
}

const expansionCache = new WeakMap<FactoryProject, FactoryProject>();

/** A later graph expansion preserves the already-expanded recipe sections. */
export function inheritSharedMachineExpansion(from: FactoryProject, to: FactoryProject): void {
  if (expansionCache.get(from) === from) expansionCache.set(to, to);
}

/**
 * The plan with every extra section stood up as its own hidden node, wires
 * re-pointed at the section they land on (prefix stripped). Memoized per
 * project object, and the expansion expands to itself. This is what the
 * solver and every graph-walking diagnosis read; the board never sees it.
 */
export function expandSharedMachines(project: FactoryProject): FactoryProject {
  if (!hasSharedMachines(project)) {
    return project;
  }
  const cached = expansionCache.get(project);
  if (cached) {
    return cached;
  }
  const sharedIds = new Set(project.nodes.filter(isSharedMachineNode).map((node) => node.id));
  const nodes: FactoryNode[] = [];
  for (const node of project.nodes) {
    for (const { node: view } of listNodeSections(node)) {
      nodes.push(view);
    }
  }
  const edges = project.edges.map((edge) => {
    let next = edge;
    if (sharedIds.has(edge.source)) {
      const { section, handleId } = splitSectionHandleId(edge.sourceHandle);
      if (section > 0) {
        next = { ...next, source: sectionNodeId(edge.source, section), sourceHandle: handleId };
      }
    }
    if (sharedIds.has(edge.target)) {
      const { section, handleId } = splitSectionHandleId(edge.targetHandle);
      if (section > 0) {
        next = { ...next, target: sectionNodeId(edge.target, section), targetHandle: handleId };
      }
    }
    return next;
  });
  const expanded: FactoryProject = { ...project, nodes, edges };
  expansionCache.set(project, expanded);
  expansionCache.set(expanded, expanded);
  return expanded;
}

/**
 * The solve ids that share one machine, card by card, over an EXPANDED
 * plan's node ids: `card -> [card, card#r1, card#r2, ...]`. Cards with one
 * section are left out.
 */
export function listSharedMachineGroups(nodeIds: Iterable<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const { nodeId, section } = parseSectionNodeId(id);
    if (section === 0) {
      continue;
    }
    const group = groups.get(nodeId);
    if (group) {
      group.push(id);
    } else {
      groups.set(nodeId, [nodeId, id]);
    }
  }
  return groups;
}

/** Every solve id a card answers to: itself and its sections. */
export function listSectionNodeIds(node: FactoryNode): string[] {
  return listNodeSections(node).map(({ node: view }) => view.id);
}
