import { NextResponse } from "next/server";
import { deleteCustomRecipe, listCustomRecipes, updateCustomRecipe } from "@/lib/server/custom-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ recipeId: string }> };

export async function GET(_request: Request, context: Context) {
  const { recipeId } = await context.params;
  const recipe = (await listCustomRecipes(true)).find((entry) => entry.id === recipeId);
  return recipe
    ? NextResponse.json({ recipe })
    : NextResponse.json({ error: "Custom recipe not found." }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  try {
    const { recipeId } = await context.params;
    const result = await updateCustomRecipe(recipeId, await request.json());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Recipe could not be updated." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { recipeId } = await context.params;
    const hard = new URL(request.url).searchParams.get("hard") === "true";
    await deleteCustomRecipe(recipeId, hard);
    return NextResponse.json({ ok: true, hard });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Recipe could not be deleted." }, { status: 400 });
  }
}
