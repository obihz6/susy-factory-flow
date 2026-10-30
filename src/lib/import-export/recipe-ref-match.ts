import type { Recipe, RecipeInput, RecipeOutput, ResourceAmount, ResourceKind } from "@/lib/model/types";
import type { RecipeQueryClause } from "@/lib/datasets/recipe-query";

/**
 * What an imported plan knows about a recipe the dataset no longer lists.
 *
 * Recipe ids are minted per dataset build and are not stable across
 * rebuilds. The only durable identity a recipe has is what it does: which
 * slots it takes and makes, how long it runs and what it draws. That is what
 * a ref carries and what a candidate is scored against.
 */
export interface RecipeRefSlot {
  kind: ResourceKind;
  id: string;
  amount?: number;
  accepted?: Array<{ kind?: ResourceKind; id: string }>;
  groupId?: string;
}

export interface RecipeContentRef {
  id: string;
  name: string;
  machineType: string;
  recipeMap?: string;
  rawRecipeId?: string;
  inputs?: RecipeRefSlot[];
  outputs: RecipeRefSlot[];
  durationTicks?: number;
  eut?: number;
}

export type RecipeRefCandidate = Pick<
  Recipe,
  "id" | "name" | "machineType" | "inputs" | "outputs" | "durationTicks" | "eut"
> & { source?: { recipeMap?: string } };

export interface RecipeRefMatch<T extends RecipeRefCandidate> {
  candidate: T;
  /** Every slot, amount, tick and EU agrees: the same recipe under a new id. */
  exact: boolean;
  score: number;
}

const EXACT_SCORE = 400;

function slotKey(slot: RecipeRefSlot | { kind: ResourceKind; id: string; accepted?: Array<{ id: string }>; groupId?: string }): string {
  // A slot that accepts a whole group is identified by the group, not by
  // whichever member happened to be listed first in this dataset build.
  // Recipe ids are minted per build and the primary member can flip between
  // builds, so a literal id would make the same recipe look different.
  if (slot.groupId) {
    return `${slot.kind}:group:${slot.groupId}`;
  }
  const accepted = slot.accepted?.map((entry) => entry.id) ?? [];
  if (accepted.length >= 2) {
    const ids = [...new Set([slot.id, ...accepted])].sort();
    return `${slot.kind}:group:${ids.join(",")}`;
  }
  return `${slot.kind}:${slot.id}`;
}

function slotAmountKey(slot: RecipeRefSlot): string {
  return `${slotKey(slot)}:${slot.amount ?? 0}`;
}

function consumedInputs(inputs: RecipeInput[] | RecipeRefSlot[] | undefined): RecipeRefSlot[] {
  return (inputs ?? []).filter(
    (input) => (input as RecipeInput).consumed !== false,
  ) as RecipeRefSlot[];
}

function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((entry, index) => entry === sortedRight[index]);
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let shared = 0;
  for (const entry of left) {
    if (right.has(entry)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}

/** Outputs the plan expects must all still come out: a wire lands on each. */
export function outputsAreCompatible(
  importedOutputs: Array<Pick<RecipeOutput, "kind" | "id">>,
  candidateOutputs: Array<Pick<RecipeOutput, "kind" | "id">>,
): boolean {
  if (importedOutputs.length === 0) {
    return true;
  }
  const candidateResources = new Set(candidateOutputs.map(slotKey));
  return importedOutputs.every((output) => candidateResources.has(slotKey(output)));
}

/**
 * How well a dataset recipe stands in for the ref. 0 means it cannot.
 *
 * Tiers, highest first: the same content down to amounts, ticks and EU; the
 * same resources in and out; the same outputs with the inputs mostly
 * shared. The name and machine type only break ties inside a tier, so a
 * renamed output never hides the recipe that still makes it, and two
 * recipes sharing a name (the two Steel Ingot blast furnace recipes) are
 * told apart by what they take.
 */
export function scoreRecipeRefCandidate(
  ref: RecipeContentRef,
  candidate: RecipeRefCandidate,
): number {
  const candidateMap = candidate.source?.recipeMap;
  if (
    ref.recipeMap &&
    candidateMap &&
    candidateMap !== ref.recipeMap &&
    candidate.machineType !== ref.machineType
  ) {
    return 0;
  }
  if (!outputsAreCompatible(ref.outputs, candidate.outputs)) {
    return 0;
  }

  const refInputs = consumedInputs(ref.inputs);
  const candidateInputs = consumedInputs(candidate.inputs);
  const refInputIds = new Set(refInputs.map(slotKey));
  const candidateInputIds = new Set(candidateInputs.map(slotKey));
  const refOutputIds = new Set(ref.outputs.map(slotKey));
  const candidateOutputIds = new Set(candidate.outputs.map(slotKey));
  const refKnowsInputs = ref.inputs !== undefined;

  let score: number;
  const sameInputIds = !refKnowsInputs || sameSet(refInputIds, candidateInputIds);
  const sameOutputIds = sameSet(refOutputIds, candidateOutputIds);
  const sameTiming =
    (ref.durationTicks === undefined || ref.durationTicks === candidate.durationTicks) &&
    (ref.eut === undefined || ref.eut === candidate.eut);
  const sameAmounts =
    (!refKnowsInputs ||
      sameMultiset(refInputs.map(slotAmountKey), candidateInputs.map(slotAmountKey))) &&
    sameMultiset(ref.outputs.map(slotAmountKey), candidate.outputs.map(slotAmountKey));

  if (sameInputIds && sameOutputIds && sameAmounts && sameTiming && refKnowsInputs) {
    score = EXACT_SCORE;
  } else if (sameInputIds && sameOutputIds) {
    score = 300 + (sameTiming ? 50 : 0) + (sameAmounts ? 25 : 0);
  } else {
    const ratio = refKnowsInputs ? overlapRatio(refInputIds, candidateInputIds) : 0;
    score = 100 + Math.round(ratio * 100) + (sameOutputIds ? 20 : 0) + (sameTiming ? 10 : 0);
  }

  if (candidate.name === ref.name) {
    score += 3;
  }
  if (candidate.machineType === ref.machineType) {
    score += 2;
  }
  return score;
}

/**
 * The best stand-in among the candidates, ties going to the earliest, so the
 * pick is the same every time the same plan is imported.
 */
export function pickRecipeRefMatch<T extends RecipeRefCandidate>(
  ref: RecipeContentRef,
  candidates: Iterable<T>,
): RecipeRefMatch<T> | undefined {
  let best: RecipeRefMatch<T> | undefined;
  for (const candidate of candidates) {
    if (candidate.id === ref.id) {
      continue;
    }
    const score = scoreRecipeRefCandidate(ref, candidate);
    if (score === 0 || (best && score <= best.score)) {
      continue;
    }
    best = { candidate, score, exact: score >= EXACT_SCORE };
  }
  return best;
}

/** The ref an exported recipe body turns into. */
export function recipeContentRef(recipe: Recipe): RecipeContentRef {
  return {
    id: recipe.id,
    name: recipe.name,
    machineType: recipe.machineType,
    recipeMap: recipe.source?.recipeMap,
    rawRecipeId: recipe.source?.rawRecipeId,
    inputs: recipe.inputs.map((input) => ({
      kind: input.kind,
      id: input.id,
      amount: input.amount,
      ...(input.consumed === false ? { consumed: false } : {}),
      ...(input.accepted?.length
        ? { accepted: input.accepted.map((entry) => ({ kind: entry.kind, id: entry.id })) }
        : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
    })),
    outputs: recipe.outputs.map((output) => ({
      kind: output.kind,
      id: output.id,
      amount: output.amount,
    })),
    durationTicks: recipe.durationTicks,
    eut: recipe.eut,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: deterministic, output-aware recipe selection.
// ---------------------------------------------------------------------------

export interface RecipeSelectionRequest {
  /** Explicit pin: wins over everything, including ambiguity. */
  recipeId?: string;
  /** What the downstream flow must receive. Drives disambiguation. */
  requiredOutputs?: Array<Pick<ResourceAmount, "kind" | "id" | "accepted" | "groupId">>;
  machineHandlerId?: string;
  inputClauses?: RecipeQueryClause[];
}

export interface RecipeSelectionResult {
  recipe: Recipe;
  score: number;
  exact: boolean;
  /** Other candidates that tied on the primary criteria. */
  rivals: Recipe[];
  /** True when requiredOutputs reduced the choice to one candidate. */
  unambiguous: boolean;
}

function resourceSlotsCompatible(
  a: Pick<ResourceAmount, "kind" | "id" | "accepted" | "groupId">,
  b: Pick<ResourceAmount, "kind" | "id" | "accepted" | "groupId">,
): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.id === b.id) {
    return true;
  }
  if (a.groupId && a.groupId === b.groupId) {
    return true;
  }
  const aIds = new Set([a.id, ...(a.accepted?.map((entry) => entry.id) ?? [])]);
  const bIds = new Set([b.id, ...(b.accepted?.map((entry) => entry.id) ?? [])]);
  for (const id of aIds) {
    if (bIds.has(id)) {
      return true;
    }
  }
  return false;
}

/**
 * Picks a recipe deterministically among candidates that share inputs.
 *
 * Order of precedence:
 *   1. an explicit `recipeId` pin;
 *   2. required-output coverage (a candidate must make every required output;
 *      candidates that do not are kept only as rivals for the UI);
 *   3. input-clause overlap;
 *   4. lower EU/t, then shorter duration;
 *   5. recipe id (final, deterministic tie-break).
 *
 * Ambiguity is reported, never resolved by guessing: `rivals` lists every
 * candidate that tied on (2) and (3), and `unambiguous` is true only when
 * (2) left a single candidate.
 */
export function selectRecipeForNode(
  request: RecipeSelectionRequest,
  candidates: Iterable<Recipe>,
): RecipeSelectionResult | undefined {
  const list = [...candidates];
  if (list.length === 0) {
    return undefined;
  }

  if (request.recipeId) {
    const pinned = list.find((candidate) => candidate.id === request.recipeId);
    if (pinned) {
      return { recipe: pinned, score: Number.POSITIVE_INFINITY, exact: true, rivals: [], unambiguous: true };
    }
  }

  const required = request.requiredOutputs ?? [];
  const clauses = request.inputClauses ?? [];

  const scored = list.map((candidate) => {
    const outputCoverage = required.length === 0
      ? 0
      : required.filter((req) => candidate.outputs.some((out) => resourceSlotsCompatible(req, out))).length;
    const allOutputs = required.length === 0 || outputCoverage === required.length;
    const inputOverlap = clauses.length === 0
      ? 0
      : candidate.inputs.filter((input) =>
          clauses.some((clause) => clause.kind === input.kind && clause.id === input.id),
        ).length;
    return { candidate, outputCoverage, allOutputs, inputOverlap };
  });

  // Sort: allOutputs first, then outputCoverage desc, inputOverlap desc,
  // eu asc, duration asc, id asc.
  scored.sort((left, right) => {
    if (left.allOutputs !== right.allOutputs) return left.allOutputs ? -1 : 1;
    if (right.outputCoverage !== left.outputCoverage) return right.outputCoverage - left.outputCoverage;
    if (right.inputOverlap !== left.inputOverlap) return right.inputOverlap - left.inputOverlap;
    if (left.candidate.eut !== right.candidate.eut) return left.candidate.eut - right.candidate.eut;
    if (left.candidate.durationTicks !== right.candidate.durationTicks) {
      return left.candidate.durationTicks - right.candidate.durationTicks;
    }
    return left.candidate.id < right.candidate.id ? -1 : left.candidate.id > right.candidate.id ? 1 : 0;
  });

  const winner = scored[0]!;
  const topKey = `${winner.outputCoverage}|${winner.inputOverlap}|${winner.allOutputs}`;
  const rivals = scored
    .filter((entry) => `${entry.outputCoverage}|${entry.inputOverlap}|${entry.allOutputs}` === topKey)
    .map((entry) => entry.candidate)
    .filter((candidate) => candidate.id !== winner.candidate.id);

  const unambiguous =
    required.length > 0 &&
    winner.allOutputs &&
    rivals.length === 0;

  return {
    recipe: winner.candidate,
    score: winner.outputCoverage * 100 + winner.inputOverlap,
    exact: winner.allOutputs && rivals.length === 0,
    rivals,
    unambiguous,
  };
}

/**
 * Like pickRecipeRefMatch, but reports rivals instead of silently taking the
 * earliest candidate. pickRecipeRefMatch is kept for callers that only want
 * the best stand-in.
 */
export function pickRecipeRefMatchWithRivals<T extends RecipeRefCandidate>(
  ref: RecipeContentRef,
  candidates: Iterable<T>,
): { best: RecipeRefMatch<T> | undefined; rivals: T[] } {
  const list = [...candidates].filter((candidate) => candidate.id !== ref.id);
  const scored = list
    .map((candidate) => ({ candidate, score: scoreRecipeRefCandidate(ref, candidate) }))
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) {
    return { best: undefined, rivals: [] };
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.candidate.id < right.candidate.id ? -1 : left.candidate.id > right.candidate.id ? 1 : 0;
  });

  const topScore = scored[0]!.score;
  const topEntries = scored.filter((entry) => entry.score === topScore);
  const best = { candidate: topEntries[0]!.candidate, score: topScore, exact: topScore >= EXACT_SCORE };
  const rivals = topEntries.slice(1).map((entry) => entry.candidate);
  return { best, rivals };
}
