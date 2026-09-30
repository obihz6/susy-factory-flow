import { NextResponse } from "next/server";
import {
  createCustomRecipe,
  customRecipeToRecipe,
  listCustomRecipes,
} from "@/lib/server/custom-recipes";
import { queryDatasetRecipes } from "@/lib/server/dataset-query";
import { listAvailableVersions, readLocalVersionRecipes } from "@/lib/server/local-versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const versionId = url.searchParams.get("versionId");
    const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
    const custom = (await listCustomRecipes()).filter((recipe) =>
      !versionId || recipe.sourceVersion === versionId || recipe.sourceVersion === "local-dev",
    );
    const available = await listAvailableVersions();
    const selectedVersion = versionId ? available.versions.find((version) => version.id === versionId) : undefined;
    if (versionId && !selectedVersion) {
      return NextResponse.json({ error: "Version not found." }, { status: 404 });
    }
    const local = selectedVersion?.local ? await readLocalVersionRecipes(selectedVersion.id) : [];
    const publishedVersions = selectedVersion && !selectedVersion.local
      ? [selectedVersion]
      : versionId
        ? []
        : available.versions.filter((version) => !version.local);
    const published = (await Promise.all(publishedVersions.map(async (version) => {
      const result = await queryDatasetRecipes(version.id, {
        query,
        mode: "recipes",
        maxTier: "all",
        offset: 0,
        limit: 120,
        allMaps: true,
        browseAll: true,
      });
      return result.recipes;
    }))).flat();
    const recipes = [
      ...published.map((recipe) => ({ recipe, source: "published" as const })),
      ...local.map((recipe) => ({ recipe, source: "local-version" as const })),
      ...custom.map((recipe) => ({ recipe: customRecipeToRecipe(recipe), source: "custom" as const })),
    ].filter(({ recipe }) => {
      if (!query) return true;
      return [recipe.name, recipe.machineType, ...recipe.inputs.map((input) => input.id), ...recipe.outputs.map((output) => output.id)]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    return NextResponse.json({ recipes, total: recipes.length, versions: available.versions.map((version) => version.id) }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Recipes could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await createCustomRecipe(body as never);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Recipe could not be created." }, { status: 400 });
  }
}
