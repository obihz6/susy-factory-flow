import { NextResponse } from "next/server";
import { listRecipeHistory } from "@/lib/server/custom-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ recipeId: string }> }) {
  try {
    const { recipeId } = await context.params;
    return NextResponse.json({ recipeId, history: await listRecipeHistory(recipeId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Recipe history could not be loaded." },
      { status: 500 },
    );
  }
}
