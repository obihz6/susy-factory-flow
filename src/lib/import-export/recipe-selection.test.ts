import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/model/types";
import { selectRecipeForNode } from "@/lib/import-export/recipe-ref-match";

function recipe(id: string, inputs: string[], outputs: string[], eut = 10): Recipe {
  return {
    id,
    name: id,
    kind: "gregtech_machine",
    machineType: "Basic Batch Reactor",
    durationTicks: 100,
    eut,
    inputs: inputs.map((value) => ({ kind: "item", id: value, amount: 1 })),
    outputs: outputs.map((value) => ({ kind: "item", id: value, amount: 1 })),
  } as Recipe;
}

describe("selectRecipeForNode", () => {
  it("picks by required output when inputs overlap", () => {
    const a = recipe("a", ["x", "y"], ["zinc_hydrochloride"]);
    const b = recipe("b", ["x", "y"], ["zinc_chloride"]);
    const result = selectRecipeForNode(
      { requiredOutputs: [{ kind: "item", id: "zinc_chloride" }] },
      [a, b],
    );
    expect(result?.recipe.id).toBe("b");
    expect(result?.unambiguous).toBe(true);
    expect(result?.rivals).toHaveLength(0);
  });

  it("reports rivals instead of guessing when outputs are not specified", () => {
    const a = recipe("a", ["x", "y"], ["zinc_hydrochloride"]);
    const b = recipe("b", ["x", "y"], ["zinc_chloride"]);
    const result = selectRecipeForNode({}, [a, b]);
    expect(result?.recipe.id).toBe("a");
    expect(result?.rivals).toHaveLength(1);
    expect(result?.unambiguous).toBe(false);
  });

  it("honours an explicit recipeId pin", () => {
    const a = recipe("a", ["x"], ["y"]);
    const b = recipe("b", ["x"], ["z"]);
    const result = selectRecipeForNode({ recipeId: "b" }, [a, b]);
    expect(result?.recipe.id).toBe("b");
    expect(result?.unambiguous).toBe(true);
  });

  it("treats accepted members as the same output", () => {
    const a = recipe("a", ["x"], ["ore_iron"]);
    (a.outputs[0] as any).accepted = [{ kind: "item", id: "gregtech:ore_iron_0" }];
    const b = recipe("b", ["x"], ["gold"]);
    const result = selectRecipeForNode(
      { requiredOutputs: [{ kind: "item", id: "gregtech:ore_iron_0" }] },
      [a, b],
    );
    expect(result?.recipe.id).toBe("a");
  });

  it("returns undefined for no candidates", () => {
    expect(selectRecipeForNode({}, [])).toBeUndefined();
  });
});
