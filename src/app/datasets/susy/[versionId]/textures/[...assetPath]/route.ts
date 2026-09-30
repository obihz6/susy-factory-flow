import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const datasetRoot = path.join(process.cwd(), "public", "datasets", "susy");
const textureRoots = new Set(["rendered", "icons", "atlas", "nei-layouts"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; assetPath: string[] }> },
) {
  const { versionId, assetPath } = await params;
  if (!isSafePathSegment(versionId) || !isSafeAssetPath(assetPath)) {
    return NextResponse.json({ error: "Invalid texture path." }, { status: 400 });
  }

  const filePath = path.join(datasetRoot, versionId, "textures", ...assetPath);
  const resolvedRoot = path.resolve(datasetRoot, versionId, "textures");
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    return NextResponse.json({ error: "Invalid texture path." }, { status: 400 });
  }

  try {
    const data = await readFile(resolvedFile);
    return new Response(data, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "image/png",
      },
    });
  } catch {
    return NextResponse.json({ error: "Texture not found." }, { status: 404 });
  }
}

function isSafeAssetPath(assetPath: string[]) {
  return (
    assetPath.length >= 2 &&
    textureRoots.has(assetPath[0] ?? "") &&
    assetPath.every(isSafePathSegment) &&
    assetPath.at(-1)?.endsWith(".png")
  );
}

function isSafePathSegment(value: string) {
  return /^[a-zA-Z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}
