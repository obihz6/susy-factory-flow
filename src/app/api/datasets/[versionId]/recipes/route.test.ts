import { describe, expect, it, vi } from "vitest";
import { queryDatasetRecipes } from "@/lib/server/dataset-query";
import { GET } from "./route";

vi.mock("@/lib/server/dataset-query", () => ({
  queryDatasetRecipes: vi.fn(async () => ({
    recipes: [],
    total: 0,
    recipeMaps: [],
    recipeMapIcons: {},
    offset: 0,
    limit: 48,
    hasMore: false,
  })),
}));

describe("recipe dataset API route", () => {
  it("accepts aspect resources for recipe lookups", async () => {
    await GET(
      new Request(
        "http://localhost/api/datasets/stable/recipes?resourceKind=aspect&resourceId=thaumcraft%3Aaspect%3Aaer&mode=recipes",
      ),
      { params: Promise.resolve({ versionId: "stable" }) },
    );

    expect(queryDatasetRecipes).toHaveBeenCalledWith(
      "stable",
      expect.objectContaining({
        resource: { kind: "aspect", id: "thaumcraft:aspect:aer" },
        mode: "recipes",
      }),
    );
  });

  it("parses stencil clauses, side operators and the all-maps flag", async () => {
    await GET(
      new Request(
        "http://localhost/api/datasets/stable/recipes?" +
          "clause=takes%3Aitem%3Agregtech%3Adust_iron&" +
          "clause=takes%3Aitem%3Agregtech%3Adust_coal&" +
          "clause=makes%3Aitem%3Agregtech%3Aingot_steel&" +
          "takesOp=all&allMaps=1",
      ),
      { params: Promise.resolve({ versionId: "stable" }) },
    );

    expect(queryDatasetRecipes).toHaveBeenCalledWith(
      "stable",
      expect.objectContaining({
        clauses: [
          { role: "takes", kind: "item", id: "gregtech:dust_iron" },
          { role: "takes", kind: "item", id: "gregtech:dust_coal" },
          { role: "makes", kind: "item", id: "gregtech:ingot_steel" },
        ],
        takesOp: "all",
        makesOp: "any",
        allMaps: true,
        mapSelection: undefined,
      }),
    );
  });

  it("parses the machine chips' map selection", async () => {
    await GET(
      new Request(
        "http://localhost/api/datasets/stable/recipes?allMaps=1&mapMode=exclude&" +
          "map=Shaped%20Crafting&map=Assembler",
      ),
      { params: Promise.resolve({ versionId: "stable" }) },
    );

    expect(queryDatasetRecipes).toHaveBeenCalledWith(
      "stable",
      expect.objectContaining({
        allMaps: true,
        mapSelection: { mode: "exclude", maps: ["Shaped Crafting", "Assembler"] },
      }),
    );

    // An empty include list is a real state: nothing selected.
    await GET(new Request("http://localhost/api/datasets/stable/recipes?allMaps=1&mapMode=include"), {
      params: Promise.resolve({ versionId: "stable" }),
    });

    expect(queryDatasetRecipes).toHaveBeenLastCalledWith(
      "stable",
      expect.objectContaining({ mapSelection: { mode: "include", maps: [] } }),
    );
  });

  it("drops malformed clauses rather than failing the request", async () => {
    await GET(
      new Request(
        "http://localhost/api/datasets/stable/recipes?" +
          "clause=eats%3Aitem%3Anope&clause=takes%3Adragon%3Anope&clause=broken&" +
          "clause=makes%3Afluid%3Aoxygen&makesOp=only",
      ),
      { params: Promise.resolve({ versionId: "stable" }) },
    );

    expect(queryDatasetRecipes).toHaveBeenCalledWith(
      "stable",
      expect.objectContaining({
        clauses: [{ role: "makes", kind: "fluid", id: "oxygen" }],
        makesOp: "only",
        allMaps: false,
      }),
    );
  });
});
