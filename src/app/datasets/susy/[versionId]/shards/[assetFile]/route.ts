import { NextResponse } from "next/server";

import {
  isSafePathSegment,
  resolveDatasetChildPath,
  serveDatasetFile,
} from "@/lib/server/dataset-static-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; assetFile: string }> },
) {
  const { versionId, assetFile } = await params;
  if (!isSafePathSegment(versionId) || !/^recipe-shard-\d{3}\.json\.gz$/.test(assetFile)) {
    return NextResponse.json({ error: "Invalid shard path." }, { status: 400 });
  }

  const filePath = resolveDatasetChildPath(versionId, "shards", assetFile);
  if (!filePath) {
    return NextResponse.json({ error: "Invalid shard path." }, { status: 400 });
  }

  try {
    return await serveDatasetFile(filePath, {
      contentType: "application/gzip",
    });
  } catch {
    return NextResponse.json({ error: "Shard not found." }, { status: 404 });
  }
}
