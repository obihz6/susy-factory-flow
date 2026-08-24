import { NextResponse } from "next/server";
import { datasetCacheHeaders } from "@/lib/server/dataset-cache-headers";
import { queryDatasetRecipes } from "@/lib/server/dataset-query";
import {
  MAX_RECIPE_QUERY_CLAUSES,
  parseRecipeQueryClause,
  type RecipeQueryClause,
  type RecipeQuerySideOp,
} from "@/lib/datasets/recipe-query";
import type { MachineTier, ResourceKind } from "@/lib/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TierFilter = "all" | Exclude<MachineTier, "DEMO">;
const RECIPE_RESOURCE_KINDS = new Set<ResourceKind>(["item", "fluid", "aspect"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const url = new URL(request.url);
    const resourceKind = url.searchParams.get("resourceKind");
    const resourceId = url.searchParams.get("resourceId");
    const clauses = parseClauses(url.searchParams.getAll("clause"));
    const result = await queryDatasetRecipes(versionId, {
      query: url.searchParams.get("query") ?? "",
      resource:
        resourceKind && resourceId && isRecipeResourceKind(resourceKind)
          ? { kind: resourceKind, id: resourceId }
          : undefined,
      mode: url.searchParams.get("mode") === "uses" ? "uses" : "recipes",
      clauses: clauses.length > 0 ? clauses : undefined,
      takesOp: parseSideOp(url.searchParams.get("takesOp")),
      makesOp: parseSideOp(url.searchParams.get("makesOp")),
      allMaps: url.searchParams.get("allMaps") === "1",
      mapSelection: parseMapSelection(url.searchParams),
      recipeMap: url.searchParams.get("recipeMap") || undefined,
      maxTier: parseTierFilter(url.searchParams.get("maxTier")),
      offset: parseOffset(url.searchParams.get("offset")),
      limit: parseLimit(url.searchParams.get("limit")),
    });
    return NextResponse.json(result, {
      headers: datasetCacheHeaders(request),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recipe query failed." },
      { status: 500 },
    );
  }
}

function isRecipeResourceKind(value: string): value is ResourceKind {
  return RECIPE_RESOURCE_KINDS.has(value as ResourceKind);
}

function parseOffset(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(120, parsed)) : 48;
}

function parseTierFilter(value: string | null): TierFilter {
  return (value || "all") as TierFilter;
}

function parseSideOp(value: string | null): RecipeQuerySideOp {
  return value === "all" || value === "only" ? value : "any";
}

/**
 * The machine chips' multi-select. `mapMode=exclude` lists unselected maps in
 * `map=` params, `mapMode=include` lists the selected ones (none is a valid
 * include list); absent means everything is selected.
 */
function parseMapSelection(
  params: URLSearchParams,
): { mode: "exclude" | "include"; maps: string[] } | undefined {
  const mode = params.get("mapMode");
  if (mode !== "exclude" && mode !== "include") {
    return undefined;
  }
  return { mode, maps: params.getAll("map") };
}

function parseClauses(raw: string[]): RecipeQueryClause[] {
  const clauses: RecipeQueryClause[] = [];
  for (const entry of raw) {
    const parsed = parseRecipeQueryClause(entry);
    if (parsed && isRecipeResourceKind(parsed.kind)) {
      clauses.push({ role: parsed.role, kind: parsed.kind, id: parsed.id });
    }
    if (clauses.length >= MAX_RECIPE_QUERY_CLAUSES) {
      break;
    }
  }
  return clauses;
}

