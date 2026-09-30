import { NextResponse } from "next/server";
import { listBackups, restoreBackup } from "@/lib/server/custom-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ backups: await listBackups() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { fileName?: string };
    if (!body.fileName) return NextResponse.json({ error: "Backup file name is required." }, { status: 400 });
    await restoreBackup(body.fileName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backup could not be restored." }, { status: 400 });
  }
}
