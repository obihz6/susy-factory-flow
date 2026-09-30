import { NextResponse } from "next/server";
import { listBackups } from "@/lib/server/custom-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ backups: await listBackups() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backups could not be listed." },
      { status: 500 },
    );
  }
}
