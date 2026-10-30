import type { Recipe, RecipeInput, RecipeOutput, ResourceKind } from "@/lib/model/types";

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
