import { NextResponse } from "next/server";
import { datasetCacheHeaders } from "@/lib/server/dataset-cache-headers";
import { datasetErrorResponse } from "@/lib/server/dataset-errors";
import { getDatasetRecipeIds } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    return NextResponse.json(
      {
        recipeIds: await getDatasetRecipeIds(versionId),
      },
      {
        headers: datasetCacheHeaders(request),
      },
    );
  } catch (error) {
    return datasetErrorResponse(error, "Recipe id list failed.");
  }
}

