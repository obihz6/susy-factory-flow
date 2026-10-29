import { NextResponse } from "next/server";
import { datasetCacheHeaders } from "@/lib/server/dataset-cache-headers";
import { datasetErrorResponse } from "@/lib/server/dataset-errors";
import { getDatasetRecipe } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string; recipeId: string }> },
) {
  try {
    const { versionId, recipeId } = await params;
    const recipe = await getDatasetRecipe(versionId, recipeId);
    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found." }, { status: 404 });
    }

    return NextResponse.json(recipe, {
      headers: datasetCacheHeaders(request),
    });
  } catch (error) {
    return datasetErrorResponse(error, "Recipe load failed.");
  }
}

