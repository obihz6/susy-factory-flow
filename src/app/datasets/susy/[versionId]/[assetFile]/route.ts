import { NextResponse } from "next/server";

import {
  isSafePathSegment,
  resolveDatasetChildPath,
  serveDatasetFile,
} from "@/lib/server/dataset-static-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const datasetFiles = new Set([
  "recipes.json",
  "recipes.json.gz",
  "recipe-index.json.gz",
  "recipe-lookup-index.json.gz",
  "resource-index.json.gz",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; assetFile: string }> },
) {
  const { versionId, assetFile } = await params;
  if (!isSafePathSegment(versionId) || !datasetFiles.has(assetFile)) {
    return NextResponse.json({ error: "Invalid dataset path." }, { status: 400 });
  }

  const filePath = resolveDatasetChildPath(versionId, assetFile);
  if (!filePath) {
    return NextResponse.json({ error: "Invalid dataset path." }, { status: 400 });
  }

  try {
    return await serveDatasetFile(filePath, {
      contentType: assetFile.endsWith(".gz") ? "application/gzip" : "application/json",
    });
  } catch {
    return NextResponse.json({ error: "Dataset file not found." }, { status: 404 });
  }
}
