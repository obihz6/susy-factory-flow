import { describe, expect, it } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  type FactoryNode,
  type FactoryProject,
  type Recipe,
} from "@/lib/model/types";
import {
  applyMachineHandlerToRecipe,
  getRecipeMachineConfigTierControls,
} from "@/lib/model/recipe-rules";
import { getMachineStructuralParallels } from "@/lib/solver/machine-effects";
import { getOverclockedRecipeStats } from "@/lib/solver/overclock";
import { describePowerStall, getNodePowerReport } from "@/lib/solver/power-report";
import { calculateThroughput } from "@/lib/solver/throughput";
import { HILE_SOURCES } from "./hile";

const recipe: Recipe = {
  id: "hile-test",
  name: "Laser engraving",
  machineType: "Hyper-Intensity Laser Engraver",
  minimumTier: "LV",
  eut: 30,
  durationTicks: 350,
  inputs: [{ kind: "item", id: "wafer", amount: 1 }],
  outputs: [{ kind: "item", id: "chip", amount: 1 }],
  // Actual old exporter key, with deliberately misleading scraped effects.
  machineConfigControls: [
    {
      id: "laserSource",
      label: "Laser Source",
      minimumKey: "a256",
      tiers: [
        {
          key: "a256",
          label: "256A Laser",
          parallelMultiplier: 99,
          resource: { kind: "item", id: "source", amount: 1 },
        },
      ],
    },
  ],
};
const node: FactoryNode = {
  id: "hile",
  recipeId: recipe.id,
  machineCount: 1,
  parallel: 1,
  position: { x: 0, y: 0 },
  enabled: true,
  overclockTier: "IV",
  hatchVoltageTier: "IV",
  hatchAmps: 1,
  machineConfigTiers: { laserSource: "uhv-65536" },
};

describe("HILE issue #50", () => {
  it("offers one source selector with all 46 registered hatch combinations", () => {
    const controls = getRecipeMachineConfigTierControls(recipe, node);
    expect(controls.map((control) => control.id)).toEqual(["laserSource"]);
    expect(controls[0].tiers).toHaveLength(46);
    expect(controls[0].current.label).toBe("UHV · 65,536A");
    expect(HILE_SOURCES.filter((s) => s.tier === "IV").map((s) => s.amps)).toEqual([256]);
    expect(HILE_SOURCES.filter((s) => s.tier === "UHV").map((s) => s.amps)).toEqual([
      256, 1024, 4096, 16384, 65536,
    ]);
    expect(HILE_SOURCES.at(-1)).toMatchObject({ tier: "UXV", amps: 536_870_912 });
  });

  it.each([
    [256, 6],
    [1024, 10],
    [4096, 16],
    [16384, 25],
    [65536, 40],
    [262144, 64],
    [1048576, 101],
    [4194304, 161],
    [16777216, 256],
    [536870912, 812],
  ])("gives %iA a structural cap of %i parallels", (amps, parallels) => {
    for (const source of HILE_SOURCES.filter((s) => s.amps === amps)) {
      expect(
        getMachineStructuralParallels(recipe, {
          ...node,
          machineConfigTiers: { laserSource: source.key },
        }),
      ).toBe(parallels);
    }
  });

  it("pays 40 parallels and overclocks from the energy hatches, not laser amps", () => {
    const stats = getOverclockedRecipeStats(recipe, node);
    const power = getNodePowerReport(recipe, node);
    expect(power.poolEuT).toBe(8192);
    expect(power.parallels).toBe(40);
    expect(stats.overclockSteps).toBe(1);
    expect(stats.durationTicks).toBe(50); // 350 / 3.5 / 2
    expect(power.drawEuT).toBe(30 * 0.8 * 40 * 4);
    const low = getNodePowerReport(recipe, { ...node, hatchVoltageTier: "LV" });
    expect(low.poolEuT).toBe(32);
    expect(low.parallels).toBe(1);
    const off = getNodePowerReport(recipe, { ...node, hatchAmps: 0 });
    expect(off.state).toBe("under-powered");
  });

  it("caps overclocks independently at laser source tier + 1", () => {
    const highPower = { ...node, hatchVoltageTier: "UXV" as const, hatchAmps: 64 };
    const withSource = (laserSource: string) =>
      getOverclockedRecipeStats(recipe, {
        ...highPower,
        machineConfigTiers: { laserSource },
      });
    expect(withSource("iv-256").overclockSteps).toBe(5); // LuV ceiling - LV recipe
    expect(withSource("luv-256").overclockSteps).toBe(6);
    expect(withSource("uv-256").overclockSteps).toBe(8);
  });

  it("preserves the named legacy hatch instead of the conflicting dummy count", () => {
    const legacy = { ...node, machineConfigTiers: { laserSource: "a65536", laserAmperage: "64" } };
    expect(getRecipeMachineConfigTierControls(recipe, legacy)[0].current.key).toBe("uhv-65536");
    expect(getMachineStructuralParallels(recipe, legacy)).toBe(40);
    expect(getOverclockedRecipeStats(recipe, legacy)).toEqual(
      getOverclockedRecipeStats(recipe, node),
    );
    expect(
      getRecipeMachineConfigTierControls(recipe, {
        machineConfigTiers: { laserAmperage: "4096" },
      })[0].current.key,
    ).toBe("zpm-4096");
    expect(
      getRecipeMachineConfigTierControls(recipe, { machineConfigTiers: {} })[0].current.key,
    ).toBe("iv-256");
  });

  it("follows the selected handler and discards baked HILE bonuses", () => {
    const family: Recipe = {
      ...recipe,
      machineType: "Laser Engraver",
      machineConfigControls: [],
      machineHandlers: [
        {
          id: "single",
          label: "Precision Laser Engraver",
          machineType: "Laser Engraver",
          minimumTier: "LV",
          kind: "single",
        },
        {
          id: "hile",
          label: recipe.machineType,
          machineType: recipe.machineType,
          minimumTier: "LV",
          kind: "multiblock",
          durationTicks: 100,
          eut: 24,
          machineConfigControls: recipe.machineConfigControls,
        },
      ],
    };
    const selected = { ...node, machineHandlerId: "hile" };
    const effective = applyMachineHandlerToRecipe(family, selected);
    expect(getRecipeMachineConfigTierControls(effective, selected)).toHaveLength(1);
    expect(getOverclockedRecipeStats(family, selected)).toEqual(
      getOverclockedRecipeStats(recipe, node),
    );
    expect(
      getRecipeMachineConfigTierControls(
        applyMachineHandlerToRecipe(family, { machineHandlerId: "single" }),
        node,
      ),
    ).toHaveLength(0);
  });

  it("stalls an over-tier recipe despite ample power and resumes with a higher source", () => {
    const highRecipe = { ...recipe, eut: 122880, minimumTier: "ZPM" as const };
    const lowSource = {
      ...node,
      hatchVoltageTier: "UXV" as const,
      machineConfigTiers: { laserSource: "iv-256" },
    };
    const report = getNodePowerReport(highRecipe, lowSource);
    expect(report.state).toBe("over-tier");
    expect(describePowerStall(report)).toContain("Laser source tier too low");
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "hile-gate",
      name: "HILE gate",
      recipes: [highRecipe],
      nodes: [lowSource],
      fuelProfiles: [],
      storages: [
        { id: "in", kind: "item", resourceId: "wafer", position: { x: -160, y: 0 } },
        { id: "out", kind: "item", resourceId: "chip", position: { x: 160, y: 0 } },
      ],
      edges: [
        { id: "feed", source: "in", target: node.id, resourceKind: "item", resourceId: "wafer" },
        { id: "ship", source: node.id, target: "out", resourceKind: "item", resourceId: "chip" },
      ],
    };
    const stalled = calculateThroughput(project);
    expect(stalled.nodes.hile.powerStalled).toBe(true);
    expect(stalled.edges.ship.transferredPerSecond).toBe(0);
    const working = calculateThroughput({
      ...project,
      nodes: [{ ...lowSource, machineConfigTiers: { laserSource: "luv-256" } }],
    });
    expect(working.nodes.hile.powerStalled).toBe(false);
    expect(working.edges.ship.transferredPerSecond).toBeGreaterThan(0);
  });
});
