import type { ResourceKind } from "@/lib/model/types";

/**
 * One condition of a recipe search: an item or fluid and which side of the
 * recipe it must appear on. "makes" means the resource is among the outputs,
 * "takes" among the inputs — the same two answers the book has always given,
 * now composable.
 */
export interface RecipeQueryClause {
  kind: ResourceKind;
  id: string;
  role: RecipeQueryRole;
}

export type RecipeQueryRole = "makes" | "takes";

/**
 * How a side's clauses read: "any" matches a recipe touching any one of them,
 * "all" demands every one of them (extras allowed), and "only" demands every
 * one of them and nothing else on that side.
 */
export type RecipeQuerySideOp = "any" | "all" | "only";

/** More conditions than anyone can mean; the server refuses the excess. */
export const MAX_RECIPE_QUERY_CLAUSES = 16;

/** The lookup-index direction a clause reads: outputs for makes, inputs for takes. */
export function recipeQueryClauseMode(role: RecipeQueryRole): "recipes" | "uses" {
  return role === "makes" ? "recipes" : "uses";
}

/** Wire form of a clause, `role:kind:id`. Ids may themselves carry colons. */
export function serializeRecipeQueryClause(clause: RecipeQueryClause): string {
  return `${clause.role}:${clause.kind}:${clause.id}`;
}

export function parseRecipeQueryClause(raw: string): Omit<RecipeQueryClause, "kind"> &
  { kind: string } | undefined {
  const first = raw.indexOf(":");
  const second = first < 0 ? -1 : raw.indexOf(":", first + 1);
  if (second < 0) {
    return undefined;
  }
  const role = raw.slice(0, first);
  const kind = raw.slice(first + 1, second);
  const id = raw.slice(second + 1);
  if ((role !== "makes" && role !== "takes") || !kind || !id) {
    return undefined;
  }
  return { role, kind, id };
}
