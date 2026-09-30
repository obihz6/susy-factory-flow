import { NextResponse } from "next/server";
import { importCustomRecipes } from "@/lib/server/custom-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown;
    const replace = isRecord(body) && body.replace === true;
    const payload = isRecord(body) && "recipes" in body ? body.recipes : body;
    const result = await importCustomRecipes(
      Array.isArray(payload) ? { schemaVersion: 1, recipes: payload } : payload,
      replace,
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Recipes could not be imported." }, { status: 400 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
