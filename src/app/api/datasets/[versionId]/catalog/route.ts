import { NextResponse } from "next/server";
import { datasetCacheHeaders } from "@/lib/server/dataset-cache-headers";
import { datasetErrorResponse } from "@/lib/server/dataset-errors";
import { getDatasetCatalog, prewarmDatasetVersion } from "@/lib/server/dataset-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    void prewarmDatasetVersion(versionId).catch((error) => {
      console.error(`Dataset ${versionId} prewarm failed.`, error);
    });
    const catalog = await getDatasetCatalog(versionId);
    return NextResponse.json(catalog, {
      headers: datasetCacheHeaders(request),
    });
  } catch (error) {
    return datasetErrorResponse(error, "Dataset catalog failed.");
  }
}

