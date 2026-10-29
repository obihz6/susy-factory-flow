import { NextResponse } from "next/server";
import { datasetCacheHeaders } from "@/lib/server/dataset-cache-headers";
import { datasetErrorResponse } from "@/lib/server/dataset-errors";
import { listDatasetCropFarmRecipes } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const result = await listDatasetCropFarmRecipes(versionId);
    return NextResponse.json(result, {
      headers: datasetCacheHeaders(request),
    });
  } catch (error) {
    return datasetErrorResponse(error, "Crop query failed.");
  }
}
