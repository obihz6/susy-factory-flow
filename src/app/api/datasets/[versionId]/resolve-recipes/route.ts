import { NextResponse } from "next/server";
import { datasetErrorResponse } from "@/lib/server/dataset-errors";
import { type DatasetRecipeRef, resolveDatasetRecipeRefs } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const body = (await request.json()) as { recipes?: DatasetRecipeRef[] };
    return NextResponse.json(
      {
        matches: await resolveDatasetRecipeRefs(versionId, body.recipes ?? []),
      },
      {
        headers: datasetCacheHeaders(),
      },
    );
  } catch (error) {
    return datasetErrorResponse(error, "Recipe resolution failed.");
  }
}

function datasetCacheHeaders() {
  return {
    "Cache-Control": "no-store",
  };
}
