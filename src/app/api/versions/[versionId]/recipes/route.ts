import { NextResponse } from "next/server";
import { queryDatasetRecipes } from "@/lib/server/dataset-query";
import { listAvailableVersions, readLocalVersionRecipes } from "@/lib/server/local-versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ versionId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { versionId } = await context.params;
    const selected = (await listAvailableVersions()).versions.find((version) => version.id === versionId);
    if (!selected) return NextResponse.json({ error: "Version not found." }, { status: 404 });
    if (selected.local) {
      const recipes = await readLocalVersionRecipes(versionId);
      return NextResponse.json({ recipes, total: recipes.length, versionId });
    }
    const url = new URL(request.url);
    const result = await queryDatasetRecipes(versionId, {
      query: url.searchParams.get("query") ?? "",
      mode: "recipes",
      maxTier: "all",
      offset: parseNonNegativeInt(url.searchParams.get("offset")),
      limit: Math.min(120, Math.max(1, parseNonNegativeInt(url.searchParams.get("limit")) || 48)),
      allMaps: true,
      browseAll: true,
    });
    return NextResponse.json({ ...result, versionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Version recipes could not be loaded." },
      { status: 500 },
    );
  }
}

function parseNonNegativeInt(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
}
