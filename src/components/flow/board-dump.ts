/**
 * A diagnostic dump of the board, or of the cards you have selected.
 *
 * This exists to be PASTED - into a bug report, a chat window, a text file -
 * and read by someone who cannot see your board. So it is written for a
 * stranger, not for the app: every card gets a short handle (M1, D2), every
 * number carries its unit in the key, and nothing appears that would not help
 * answer "why is this machine not running".
 *
 * Deliberately absent: positions, colours, icon paths, NEI slot layouts, the
 * full recipe rows, and every id the reader cannot act on. Those are most of a
 * plan's bytes and none of its meaning. The real node ids ARE kept, one per
 * card, because they are how a report gets matched back to a saved plan.
 *
 * The numbers are the solver's own - `result` is what the board is drawing
 * right now - with the per-machine overclock math restated alongside it, since
 * "480 EU/t recipe, 4 overclocks, 6 parallels, 7680 EU/t each" is the line that
 * usually settles an argument about power.
 */
import {
  applyMachineHandlerToRecipe,
  getRecipeCoilTierControl,
  getRecipeMachineConfigTierControls,
  getSelectedMachineHandler,
} from "@/lib/model/recipe-rules";
import { applyRecipeInputOverrides } from "@/lib/model/recipe-input-overrides";
import { expandPocketSelection } from "@/lib/model/pocket-connections";
import { getStorageRoles } from "@/lib/model/storage-role";
import { getSetupRules } from "@/lib/model/setup-rules";
import { getCustomRateDial, isCustomRateRecipe } from "@/lib/model/custom-rate";
import { isTrashRecipe } from "@/lib/model/trash";
import { getMachineParallelMultiplier } from "@/lib/solver/machine-effects";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { calculateSelectionFlow } from "@/lib/solver/selection-flow";
import type {
  FactoryNode,
  FactoryProject,
  Recipe,
  ResourceBalance,
  ResourceFlow,
  ThroughputResult,
} from "@/lib/model/types";
import { APP_VERSION } from "@/lib/version";
import { deriveNodeVerdict, type NodeVerdict } from "./node-verdict";
import { findDeathSpirals } from "./death-spiral";

/** Kept as short lines: one long paragraph wraps into mush in a chat window. */
const READ_ME = [
  "GTNH Planner diagnostics.",
  "Rates are per second, durations in seconds, power in EU/tick.",
  "Cards are referenced by handle: M = machine, D = drawer.",
  "A machine's in/out reads 'flowing now of what it would move at full speed'.",
];

export interface BoardDumpOptions {
  project: FactoryProject;
  result: ThroughputResult | undefined;
  /** Board selection. Empty means dump the whole plan. */
  selectedIds: readonly string[];
}

/**
 * Build the dump object. Kept separate from the string so tests can assert on
 * fields rather than on formatting.
 */
export function buildBoardDump({ project, result, selectedIds }: BoardDumpOptions) {
  const scope = resolveScope(project, selectedIds);
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe] as const));
  const storageRoles = getStorageRoles(project);
  const spirals = findDeathSpirals(project, result);

  const nodes = project.nodes.filter((node) => scope.itemIds.has(node.id));
  const storages = (project.storages ?? []).filter((storage) => scope.itemIds.has(storage.id));
  const edges = project.edges.filter(
    (edge) => scope.itemIds.has(edge.source) && scope.itemIds.has(edge.target),
  );

  // Handles are assigned in board reading order (top-left first) so two dumps
  // of the same plan name the same cards, and so a reader scanning the list
  // meets the cards in the order they would meet them on screen.
  const refs = new Map<string, string>();
  [...nodes]
    .sort(byBoardPosition)
    .forEach((node, index) => refs.set(node.id, `M${index + 1}`));
  [...storages]
    .sort(byBoardPosition)
    .forEach((storage, index) => refs.set(storage.id, `D${index + 1}`));

  const naming: Naming = { byKey: new Map(), ids: new Map() };
  const machines = nodes
    .map((node) => {
      const recipe = recipesById.get(node.recipeId);
      return recipe
        ? dumpMachine(project, result, node, recipe, refs, naming)
        : { ref: refs.get(node.id), id: node.id, recipe: "MISSING RECIPE", recipeId: node.recipeId };
    })
    .sort((a, b) => String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }));

  const dump: Record<string, unknown> = {
    _: READ_ME,
    planner: APP_VERSION,
    plan: project.name,
    // Which dataset built these recipes. A rate that looks wrong is sometimes a
    // recipe that changed under the plan, and this is the first thing to check.
    dataset: project.recipes.find((recipe) => recipe.source?.datasetVersionId)?.source
      ?.datasetVersionId,
    scope: scope.label,
  };
  dropEmpty(dump);

  const rules = getSetupRules(project);
  if (rules.freeInputs || rules.freeOutputs) {
    dump.setupRules = [
      rules.freeInputs ? "free inputs: any input short of stock is topped up" : undefined,
      rules.freeOutputs ? "free outputs: any surplus leaves the setup instead of clogging" : undefined,
    ]
      .filter(Boolean)
      .join("; ");
  }
  if (result) {
    dump.power = dropEmpty({
      euPerTickWhenEverythingRuns: round(scopeEuT(result, nodes, false)),
      euPerTickAverage: round(scopeEuT(result, nodes, true)),
      wholePlanEuPerTick: scope.isSelection ? round(result.totalEuT) : undefined,
    });
  }

  const boundary = describeBoundary(project, result, scope, naming);
  if (boundary) {
    dump.boundary = boundary;
  }

  const loops = spirals.spirals
    .filter((spiral) => spiral.nodeIds.some((id) => scope.itemIds.has(id)))
    .map((spiral) => ({
      cards: spiral.nodeIds.map((id) => refs.get(id) ?? id),
      goods: spiral.resourceNames,
      note: spiral.hasExternalSource
        ? spiral.externalSourceDry
          ? "fed from outside, but that feed delivers nothing"
          : "fed from outside"
        : "nothing feeds this ring, so it can never start",
    }));
  if (loops.length) {
    dump.deadLoops = loops;
  }

  dump.machines = machines;
  if (storages.length) {
    dump.drawers = storages
      .map((storage) => {
        const storageResult = result?.storages[storage.id];
        return dropEmpty({
          ref: refs.get(storage.id),
          id: storage.id,
          resource: nameResource(
            storage.kind,
            storage.resourceId,
            storage.displayName,
            naming,
          ),
          role: storageRoles.get(storage.id) ?? "idle",
          drainMode: storage.drainMode,
          bufferMode: storage.bufferMode,
          inPerSec: round(storageResult?.producedPerSecond),
          outPerSec: round(storageResult?.consumedPerSecond),
          netPerSec: round(storageResult?.netPerSecond),
          status: storageResult?.status,
        });
      })
      .sort((a, b) => String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }));
  }

  const links = edges.map((edge) => {
    const flow = result?.edges[edge.id];
    const moved = round(flow?.transferredPerSecond) ?? edge.ratePerSecond;
    const wanted = round(flow?.nameplateDemandPerSecond);
    const parts = [
      `${refs.get(edge.source) ?? edge.source} -> ${refs.get(edge.target) ?? edge.target}`,
      nameResource(
        edge.resourceKind,
        edge.resourceId,
        flow?.resource.displayName ?? edge.label,
        naming,
      ),
      `${moved ?? "?"}/s`,
    ];
    if (wanted !== undefined && moved !== undefined && Math.abs(wanted - moved) > 1e-6) {
      parts.push(`(wants ${wanted}/s)`);
    }
    if (flow && flow.constraint !== "full") {
      parts.push(flow.constraint === "supply" ? "[short]" : "[not needed]");
    }
    return parts.join("  ");
  });
  if (links.length) {
    dump.links = links;
  } else if (nodes.length > 1) {
    dump.links = "none: nothing in this scope is wired to anything else in it";
  }

  const warnings = (result?.bottlenecks ?? [])
    .filter((report) => !report.nodeId || scope.itemIds.has(report.nodeId))
    .map((report) =>
      report.nodeId ? `${refs.get(report.nodeId) ?? report.nodeId}: ${report.message}` : report.message,
    );
  if (warnings.length) {
    dump.warnings = [...new Set(warnings)];
  }

  if (naming.ids.size) {
    // Names collide (three different "Circuit"s) and a name is not something
    // the dataset can be searched by. One line each, at the bottom, out of the
    // way of the reading but there when the argument is about identity.
    dump.resourceIds = Object.fromEntries(
      [...naming.ids].sort((a, b) => a[0].localeCompare(b[0])),
    );
  }

  return dump;
}

/** The dump as the text that lands on the clipboard. */
export function formatBoardDump(options: BoardDumpOptions): string {
  return prettyJson(buildBoardDump(options));
}

function dumpMachine(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  node: FactoryNode,
  recipe: Recipe,
  refs: Map<string, string>,
  naming: Naming,
) {
  const handler = getSelectedMachineHandler(recipe, node);
  const withHandler = applyMachineHandlerToRecipe(recipe, node);
  const effective = applyRecipeInputOverrides(withHandler, node);
  const stats = getOverclockedRecipeStats(recipe, node);
  const parallels = getMachineParallelMultiplier(effective, node);
  const nodeResult = result?.nodes[node.id];
  const verdict = deriveNodeVerdict(project, result, node.id);

  const config: Record<string, string> = {};
  const coil = getRecipeCoilTierControl(effective, node);
  if (coil) {
    config[coil.label] = coil.current.label;
  }
  for (const control of getRecipeMachineConfigTierControls(effective, node)) {
    config[control.label] = control.current.label;
  }

  const dial = isCustomRateRecipe(recipe) ? getCustomRateDial(node, recipe) : undefined;

  return dropEmpty({
    ref: refs.get(node.id),
    id: node.id,
    recipe: recipe.name,
    recipeId: recipe.id,
    machine: handler.label,
    machineKind: handler.kind,
    count: node.machineCount,
    parallelSetting: node.parallel > 1 ? node.parallel : undefined,
    enabled: node.enabled === false ? false : undefined,
    dial: dial ? `${dial.mode} ${round(dial.perSecond)}/s` : undefined,
    tier: stats.tier,
    minTier: stats.minimumTier !== stats.tier ? stats.minimumTier : undefined,
    config: Object.keys(config).length ? config : undefined,
    recipeAsWritten: isTrashRecipe(recipe)
      ? undefined
      : dropEmpty({
          seconds: round(effective.durationTicks / 20),
          euPerTick: round(effective.eut),
        }),
    afterOverclock: isTrashRecipe(recipe)
      ? undefined
      : dropEmpty({
          seconds: round(stats.durationTicks / 20),
          euPerTickPerMachine: round(stats.eut * parallels),
          overclocks: stats.overclockSteps || undefined,
          parallelsFromMachine: parallels > 1 ? parallels : undefined,
        }),
    // The solver states a card's rates and power at FULL SPEED and carries the
    // throttle separately, so a dump that printed only `inputs` would claim a
    // starved machine is eating what it merely wants. Both figures, always.
    runningPct: round(verdict.pct, 1),
    runsPerSecAtFullSpeed: round(nodeResult?.operationRatePerSecond),
    euPerTick: nodeResult
      ? dropEmpty({
          whenRunning: round(nodeResult.euT),
          average: round(nodeResult.euT * utilization(nodeResult)),
        })
      : undefined,
    verdict: verdict.kind,
    why: explainVerdict(verdict, refs),
    in: describeFlows(nodeResult?.inputs, nodeResult, naming),
    out: describeFlows(nodeResult?.outputs, nodeResult, naming),
    unwired: verdict.bare
      ? dropEmpty({
          in: verdict.bare.inputs.map((slot) => slot.displayName),
          out: verdict.bare.outputs.map((slot) => slot.displayName),
        })
      : undefined,
  });
}

/**
 * One sentence naming what is holding this card back, and where to go and fix
 * it. The board says this in colour; a pasted dump has to say it in words.
 */
function explainVerdict(verdict: NodeVerdict, refs: Map<string, string>): string | undefined {
  switch (verdict.kind) {
    case "off":
      return "switched off";
    case "no-recipe":
      return "no recipe on the card";
    case "unwired":
      return "nothing wired to it";
    case "starved":
    case "blocked":
    case "bottleneck": {
      const binding = verdict.binding;
      // A bottleneck has no binding input when nothing upstream is short: the
      // card is simply too small for what the plan asks of it, which is the
      // same sentence a flat-out card with an unmet ask gets.
      if (!binding) {
        return describeDeficit(verdict);
      }
      const tied = binding.tiedWithNames?.length
        ? `, tied with ${binding.tiedWithNames.join(", ")}`
        : "";
      const upstream = binding.upstream
        ? `; fix at ${binding.upstream.name} (${binding.upstream.kind}, ${round(binding.upstream.pct, 1)}%${
            binding.upstream.machinesToAdd
              ? `, add ${binding.upstream.machinesToAdd} machines`
              : ""
          })`
        : binding.upstreamName
          ? `; fix at ${binding.upstreamName}`
          : "";
      return `short of ${binding.displayName}: gets ${round(binding.suppliedPerSecond)}/s, needs ${round(
        binding.neededPerSecond,
      )}/s${tied}${upstream}`;
    }
    case "clogged": {
      const clog = verdict.clog;
      return clog
        ? `${clog.displayName} has nowhere to go: makes ${round(clog.madePerSecond)}/s, only ${round(
            clog.takenPerSecond,
          )}/s is taken, so the card is held ${round(clog.heldBackPct, 1)} points below full`
        : undefined;
    }
    case "dead-loop":
      return verdict.spiral
        ? `trapped in a ring with ${verdict.spiral.nodeIds
            .map((id) => refs.get(id) ?? id)
            .join(", ")}: nothing outside it supplies the ring, so it never starts`
        : undefined;
    case "clog-lock":
      return verdict.clogLock
        ? `clog-locked with ${verdict.clogLock.machineIds
            .map((id) => refs.get(id) ?? id)
            .join(", ")}: ${verdict.clogLock.vents
            .map((vent) => `${vent.resourceName} ${round(vent.perSecond)}/s`)
            .join(", ")} has nowhere to go, and the jam holds every member at 0`
        : undefined;
    case "demand-set":
      return "nothing asks for more";
    case "paced":
      return "inputs covered, nothing jammed; the machines around it set the speed";
    case "balanced":
      return describeDeficit(verdict);
    default:
      return undefined;
  }
}

function describeDeficit(verdict: NodeVerdict): string | undefined {
  const deficit = verdict.deficit;
  if (!deficit) {
    return undefined;
  }
  const advice = deficit.machinesToAdd ? `; add ${deficit.machinesToAdd} machines` : "";
  return `running flat out and still ${round(deficit.missingPerSecond)}/s short of ${
    deficit.displayName
  }${advice}`;
}

function describeFlows(
  flows: Record<string, ResourceFlow> | undefined,
  nodeResult: { utilization: number } | undefined,
  naming: Naming,
): string[] | undefined {
  if (!flows) {
    return undefined;
  }
  const ratio = nodeResult ? utilization(nodeResult) : 1;
  const lines = Object.values(flows).map((flow) => {
    const name = nameResource(flow.kind, flow.resourceId, flow.displayName, naming);
    const full = round(flow.amountPerSecond);
    const now = round(flow.amountPerSecond * ratio);
    return now === full ? `${name} ${full}/s` : `${name} ${now}/s of ${full}/s`;
  });
  return lines.length ? lines : undefined;
}

/**
 * The throttle the solver keeps beside a card's full-speed figures.
 *
 * Capped at 1: above it, the figure is how much MORE the plan is asking for
 * than this card can make, and a card never runs past full blast. Scaling by
 * the raw number would have a starved smelter reporting eight times its own
 * output as its actual production.
 */
function utilization(nodeResult: { utilization: number }): number {
  if (!Number.isFinite(nodeResult.utilization)) {
    return 1;
  }
  return Math.min(1, Math.max(0, nodeResult.utilization));
}

function describeBoundary(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  scope: ReturnType<typeof resolveScope>,
  naming: Naming,
) {
  // A selection is re-solved as if it were the whole board, which is what makes
  // the boundary interesting: a good the plan makes elsewhere shows up here as
  // something this section NEEDS. Same question a pocket or a blueprint answers.
  const flow = scope.isSelection
    ? calculateSelectionFlow(project, scope.selectedIds)
    : result
      ? { externalInputs: result.externalInputs, unconsumedOutputs: result.unconsumedOutputs }
      : undefined;
  if (!flow) {
    return undefined;
  }

  const needs = flow.externalInputs.map((balance) => balanceLine(balance, "in", naming));
  const makes = flow.unconsumedOutputs.map((balance) => balanceLine(balance, "out", naming));
  if (!needs.length && !makes.length) {
    return undefined;
  }
  return dropEmpty({
    _: scope.isSelection
      ? "this section solved on its own, as if nothing else were on the board"
      : "the whole plan's edges",
    needs,
    makes,
  });
}

function balanceLine(
  balance: ResourceBalance,
  side: "in" | "out",
  naming: Naming,
): string {
  const rate = side === "in" ? balance.consumedPerSecond : balance.producedPerSecond;
  return `${nameResource(balance.kind, balance.resourceId, balance.displayName, naming)} ${round(
    rate,
  )}/s`;
}

function resolveScope(project: FactoryProject, selectedIds: readonly string[]) {
  const totalCards = project.nodes.length + (project.storages ?? []).length;
  if (selectedIds.length > 0) {
    const { itemIds } = expandPocketSelection(project, selectedIds);
    if (itemIds.size > 0) {
      return {
        isSelection: true,
        selectedIds,
        itemIds,
        label: `${itemIds.size} selected card(s) out of ${totalCards} on the plan`,
      };
    }
  }
  const itemIds = new Set<string>([
    ...project.nodes.map((node) => node.id),
    ...(project.storages ?? []).map((storage) => storage.id),
  ]);
  return {
    isSelection: false,
    selectedIds,
    itemIds,
    label: `the whole plan, ${totalCards} card(s)`,
  };
}

function scopeEuT(result: ThroughputResult, nodes: FactoryNode[], throttled: boolean): number {
  return nodes.reduce((total, node) => {
    const nodeResult = result.nodes[node.id];
    if (!nodeResult) {
      return total;
    }
    return total + nodeResult.euT * (throttled ? utilization(nodeResult) : 1);
  }, 0);
}

/**
 * A resource's readable name, remembering what it learns.
 *
 * The solver names a resource wherever the recipe named it, and leaves it as a
 * bare id everywhere else - an edge's own record carries no display name at
 * all. So the first caller that knows "item:ingot" is an Ingot teaches every
 * later one, and the links read in words rather than in ids. Machines are
 * dumped before links for exactly this reason.
 */
function nameResource(
  kind: string,
  resourceId: string,
  displayName: string | undefined,
  naming: Naming,
): string {
  const key = `${kind}:${resourceId}`;
  const name = displayName?.trim() || naming.byKey.get(key) || resourceId;
  if (name !== resourceId) {
    naming.byKey.set(key, name);
    naming.ids.set(name, key);
  }
  return name;
}

/** `byKey` is what a later caller borrows; `ids` is the dump's own footnote. */
interface Naming {
  byKey: Map<string, string>;
  ids: Map<string, string>;
}

function byBoardPosition(a: { position: { x: number; y: number } }, b: typeof a): number {
  return a.position.y - b.position.y || a.position.x - b.position.x;
}

function round(value: number | undefined, decimals = 4): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Drop keys that carry nothing, so the dump has no `"x": null` noise in it. */
function dropEmpty<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (
      entry === undefined ||
      entry === null ||
      entry === "" ||
      (Array.isArray(entry) && entry.length === 0) ||
      (isPlainObject(entry) && Object.keys(entry).length === 0)
    ) {
      delete value[key];
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INLINE_WIDTH = 96;

/**
 * JSON, but a small object stays on one line.
 *
 * `JSON.stringify(value, null, 2)` turns every three-number object into five
 * lines, and a dump of twenty machines becomes a thousand-line scroll that
 * nobody reads to the end. Anything that fits in a terminal line is written as
 * one.
 */
function prettyJson(value: unknown, indent = ""): string {
  const flat = inlineJson(value);
  if (flat.length + indent.length <= INLINE_WIDTH || typeof value !== "object" || value === null) {
    return flat;
  }

  const next = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map((item) => `${next}${prettyJson(item, next)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, item]) => `${next}${JSON.stringify(key)}: ${prettyJson(item, next)}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

/** JSON on one line, spaced the way the indented form is. */
function inlineJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => inlineJson(item)).join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
