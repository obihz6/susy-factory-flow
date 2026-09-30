import { NextResponse } from "next/server";
import { exportCustomRecipes } from "@/lib/server/custom-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ids = new URL(request.url).searchParams.getAll("id");
  const data = await exportCustomRecipes(ids.length > 0 ? ids : undefined);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=custom-recipes.json",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
