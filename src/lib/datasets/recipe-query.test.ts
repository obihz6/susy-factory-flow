import { describe, expect, it } from "vitest";
import { parseRecipeQueryClause, serializeRecipeQueryClause } from "./recipe-query";

describe("recipe query clause wire form", () => {
  it("round-trips a clause whose id itself carries colons", () => {
    const clause = { role: "takes", kind: "item", id: "gregtech:gt.metaitem.01:2032" } as const;
    expect(parseRecipeQueryClause(serializeRecipeQueryClause(clause))).toEqual(clause);
  });

  it("round-trips an oredict id", () => {
    const clause = { role: "takes", kind: "item", id: "oredict:logWood" } as const;
    expect(parseRecipeQueryClause(serializeRecipeQueryClause(clause))).toEqual(clause);
  });

  it("refuses roles that are not takes or makes", () => {
    expect(parseRecipeQueryClause("eats:item:dirt")).toBeUndefined();
  });

  it("refuses entries missing a kind or id", () => {
    expect(parseRecipeQueryClause("takes:item")).toBeUndefined();
    expect(parseRecipeQueryClause("takes::dirt")).toBeUndefined();
    expect(parseRecipeQueryClause("takes:item:")).toBeUndefined();
    expect(parseRecipeQueryClause("")).toBeUndefined();
  });
});
