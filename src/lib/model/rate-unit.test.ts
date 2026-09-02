import { afterEach, describe, expect, it } from "vitest";

import {
  formatPortRate,
  formatSlotRate,
  formatSlotRateOrNull,
  portReadsEnergy,
} from "@/components/flow/flow-explainers";
import {
  energyPerUnit,
  energyPerUnitDisplayValue,
  energyPerUnitSuffix,
  isEnergyRateUnit,
  rateUnitMultiplier,
  rateUnitSuffix,
  setActivePowerDisplayUnit,
  setActiveRateUnit,
} from "./rate-unit";

afterEach(() => {
  setActiveRateUnit("second");
});

describe("rate units", () => {
  it("reads a tick as a twentieth of a second", () => {
    setActiveRateUnit("tick");
    expect(rateUnitMultiplier()).toBeCloseTo(0.05);
    expect(rateUnitSuffix(false)).toBe("/t");
    expect(rateUnitSuffix(true)).toBe(" L/t");
    // 2,000 L/s of nitrobenzene is the figure the game itself quotes per tick.
    expect(formatSlotRate(2000, "fluid")).toBe("100 L/t");
  });

  it("keeps a slow line visible per tick", () => {
    // A chanced output at 0.004/s is a line that runs. Per tick it is twenty
    // times smaller, and a noise floor meant to hide zero must not swallow it.
    setActiveRateUnit("second");
    expect(formatSlotRateOrNull(0.004, "item")).toBe("0.004/s");
    setActiveRateUnit("tick");
    expect(formatSlotRateOrNull(0.004, "item")).toBe("0.0002/t");
  });
});

describe("EU per unit made", () => {
  it("divides the card's power by what it makes, per second", () => {
    // 100 EU/t is 2,000 EU/s; ten wood a second is 200 EU a piece.
    expect(energyPerUnit(100, 10)).toBeCloseTo(200);
    // The same ten wood at 10 EU/t is ten times cheaper.
    expect(energyPerUnit(10, 10)).toBeCloseTo(20);
    // Nothing made, nothing to divide by: no reading rather than infinity.
    expect(energyPerUnit(100, 0)).toBeUndefined();
    // Generators sit at zero here, never negative.
    expect(energyPerUnit(-64, 10)).toBe(0);
  });

  it("only outputs with a figure read as energy, and only in the EU unit", () => {
    const output = { kind: "item", energyPerUnit: 200 } as const;
    // An input with books behind it carries the EU per unit eaten; one with
    // no books (nothing solved yet) carries nothing and reads per second.
    const input = { kind: "item", energyPerUnit: undefined } as const;
    const fedInput = { kind: "item", energyPerUnit: 800 } as const;
    setActiveRateUnit("second");
    expect(isEnergyRateUnit()).toBe(false);
    expect(formatPortRate(output, 10)).toBe("10/s");
    setActiveRateUnit("eu");
    expect(isEnergyRateUnit()).toBe(true);
    expect(portReadsEnergy(output)).toBe(true);
    expect(formatPortRate(output, 10)).toBe("200 EU/Item");
    expect(formatPortRate({ kind: "fluid", energyPerUnit: 2.5 }, 1000)).toBe("2.5 EU/L");
    expect(formatPortRate(fedInput, 2.5)).toBe("800 EU/Item");
    expect(portReadsEnergy(input)).toBe(false);
    expect(formatPortRate(input, 10)).toBe("10/s");
    // Everything else on the board reads per second while the unit is on.
    expect(rateUnitMultiplier()).toBe(1);
    expect(rateUnitSuffix(true)).toBe(" L/s");
  });
});

describe("EU per unit under the amps dial", () => {
  afterEach(() => {
    setActivePowerDisplayUnit("eu");
  });

  it("reads the canvas figure in the chosen tier's amps, the browser's stays EU", () => {
    setActiveRateUnit("eu");
    setActivePowerDisplayUnit("LV");
    // 200 EU an item over LV's 32 EU/t is 6.25 LV amps an item.
    expect(formatPortRate({ kind: "item", energyPerUnit: 200 }, 10)).toBe("6.25 A LV/Item");
    expect(energyPerUnitDisplayValue(200)).toBeCloseTo(6.25);
    // The plain pair the recipe browser reads never follows the dial.
    expect(energyPerUnitSuffix("item")).toBe(" EU/Item");
    setActivePowerDisplayUnit("eu");
    expect(formatPortRate({ kind: "item", energyPerUnit: 200 }, 10)).toBe("200 EU/Item");
  });
});
