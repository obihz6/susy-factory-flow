import { describe, expect, it } from "vitest";
import {
  ENERGY_HATCH_TYPES,
  energyHatchTypeExistsAtTier,
  energyHatchTypesForTier,
  getEnergyHatchType,
} from "./energy-hatches";

describe("energy hatch families", () => {
  it("offers only the plain pair below EV", () => {
    expect(energyHatchTypesForTier("ULV").map((type) => type.id)).toEqual(["standard"]);
    expect(energyHatchTypesForTier("HV").map((type) => type.id)).toEqual(["standard"]);
  });

  it("opens the multi-amp hatches at EV and the first laser at IV", () => {
    expect(energyHatchTypesForTier("EV").map((type) => type.id)).toEqual([
      "standard",
      "amp4",
      "amp16",
      "amp64",
    ]);
    expect(energyHatchTypesForTier("IV").map((type) => type.id)).toContain("laser256");
    expect(energyHatchTypesForTier("IV").map((type) => type.id)).not.toContain("laser1k");
  });

  it("offers every family at UXV", () => {
    expect(energyHatchTypesForTier("UXV")).toHaveLength(ENERGY_HATCH_TYPES.length);
  });

  it("says whether a stored family survives a tier change", () => {
    expect(energyHatchTypeExistsAtTier("laser256", "IV")).toBe(true);
    expect(energyHatchTypeExistsAtTier("laser256", "EV")).toBe(false);
    expect(energyHatchTypeExistsAtTier(undefined, "ULV")).toBe(true);
  });

  it("falls back to the plain pair for unknown ids", () => {
    expect(getEnergyHatchType("not-a-hatch").id).toBe("standard");
    expect(getEnergyHatchType(undefined).amps).toBe(2);
  });
});
