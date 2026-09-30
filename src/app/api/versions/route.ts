import { NextResponse } from "next/server";
import { listAvailableVersions } from "@/lib/server/local-versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listAvailableVersions(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Versions could not be loaded." },
      { status: 500 },
    );
  }
}
