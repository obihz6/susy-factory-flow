import { NextResponse } from "next/server";
import { restoreBackup } from "@/lib/server/custom-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { fileName?: unknown; date?: unknown };
    const fileName = typeof body.fileName === "string"
      ? body.fileName
      : typeof body.date === "string"
        ? body.date.endsWith(".json") ? body.date : `local-dev.backup.${body.date}.json`
        : undefined;
    if (!fileName) {
      return NextResponse.json({ error: "Backup file name or date is required." }, { status: 400 });
    }
    await restoreBackup(fileName);
    return NextResponse.json({ ok: true, fileName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup could not be restored." },
      { status: 400 },
    );
  }
}
