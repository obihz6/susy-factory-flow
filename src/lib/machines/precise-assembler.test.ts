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
import { normalizeHatchInput } from "@/lib/solver/hatch-input";
import { isMultiblockRecipe } from "@/lib/solver/power";
import { prefersCuratedMachineMath } from "@/lib/solver/runtime-calculation";
import { calculateThroughput } from "@/lib/solver/throughput";

const precise: Recipe = {
  id: "prass",
  name: "Precise recipe",
  machineType: "Precise Assembler",
  minimumTier: "LuV",
  eut: 9001,
  durationTicks: 1200,
  inputs: [{ kind: "item", id: "part", amount: 1 }],
  outputs: [{ kind: "item", id: "component", amount: 1 }],
  nei: { additionalInfo: ["Special value: 1"] },
  runtimeCalculation: {
    oracleEligible: true,
    sourceKind: "gregtech-overclock-calculator",
    status: "computed",
    variants: [
      {
        id: "luv",
        label: "LuV",
        overclockTier: "LuV",
        durationTicks: 1200,
        eut: 9001,
        parallel: 1,
      },
    ],
  },
};
const normal: Recipe = {
  ...precise,
  id: "normal",
  machineType: "Precise Auto-Assembler MT-3662",
  minimumTier: "LV",
  eut: 30,
  durationTicks: 400,
  nei: undefined,
  runtimeCalculation: undefined,
};
const node: FactoryNode = {
  id: "machine",
  recipeId: precise.id,
  enabled: true,
  machineCount: 1,
  parallel: 1,
  position: { x: 0, y: 0 },
  overclockTier: "LuV",
  hatchVoltageTier: "LuV",
  hatchAmps: 1,
};

describe("Precise Auto-Assembler power and casing support", () => {
  it("recognizes both modes as curated multiblocks, enabling hatch controls", () => {
    for (const recipe of [precise, normal]) {
      const effective = applyMachineHandlerToRecipe(recipe, node);
      expect(isMultiblockRecipe(effective)).toBe(true);
      expect(prefersCuratedMachineMath(effective)).toBe(true);
      expect(getRecipeMachineConfigTierControls(effective, node).map((c) => c.id)).toEqual([
        "preciseCasing",
        "prassMachineCasing",
      ]);
    }
  });

  it.each([
    ["mk0", 16],
    ["mk1", 32],
    ["mk2", 64],
    ["mk3", 128],
    ["mk4", 256],
  ])("uses %s casing for %i normal-mode parallels at twice base speed", (casing, parallels) => {
    const configured = {
      ...node,
      hatchVoltageTier: "LV" as const,
      hatchAmps: parallels,
      machineConfigTiers: { preciseCasing: casing },
    };
    expect(getMachineStructuralParallels(normal, configured)).toBe(parallels);
    const power = getNodePowerReport(normal, configured);
    expect(power.parallels).toBe(parallels);
    expect(power.drawEuT).toBe(30 * parallels);
    expect(getOverclockedRecipeStats(normal, configured).durationTicks).toBe(200);
  });

  it("limits normal-mode parallels by actual power", () => {
    const configured = {
      ...node,
      hatchVoltageTier: "LV" as const,
      machineConfigTiers: { preciseCasing: "mk4" },
    };
    expect(getMachineStructuralParallels(normal, configured)).toBe(256);
    expect(getNodePowerReport(normal, configured).parallels).toBe(1);
  });

  it("uses recipe casing requirements in precise mode without adding parallels or speed", () => {
    const recipe = { ...precise, nei: { additionalInfo: ["Special value: 3"] } };
    const controls = getRecipeMachineConfigTierControls(recipe, {
      ...node,
      machineConfigTiers: { preciseCasing: "mk0" },
    });
    expect(controls[0].current.key).toBe("mk3");
    expect(controls[0].tiers.map((c) => c.key)).toEqual(["mk3", "mk4"]);
    for (const casing of ["mk3", "mk4"]) {
      const configured = { ...node, machineConfigTiers: { preciseCasing: casing } };
      expect(getNodePowerReport(recipe, configured).parallels).toBe(1);
      expect(getOverclockedRecipeStats(recipe, configured).durationTicks).toBe(1200);
    }
  });

  it("spends multi-amp and laser-sized supplies on precise-mode overclocks", () => {
    expect(getOverclockedRecipeStats(precise, node).durationTicks).toBe(1200);
    expect(getOverclockedRecipeStats(precise, { ...node, hatchAmps: 4 }).durationTicks).toBe(600);
    expect(getOverclockedRecipeStats(precise, { ...node, hatchAmps: 256 }).durationTicks).toBe(75);
    const low = getNodePowerReport(precise, { ...node, hatchVoltageTier: "IV", hatchAmps: 256 });
    expect(low.state).toBe("over-tier"); // No input tier skips, even with ample amps.
  });

  it("applies machine casing voltage before amps and removes the cap at UHV", () => {
    const configured = {
      ...node,
      hatchVoltageTier: "UV" as const,
      hatchAmps: 4,
      machineConfigTiers: { prassMachineCasing: "luv" },
    };
    const limited = getNodePowerReport(precise, configured);
    expect(limited.tier).toBe("LuV");
    expect(limited.poolEuT).toBe(32768 * 4);
    expect(getOverclockedRecipeStats(precise, configured).durationTicks).toBe(600);
    const uncapped = getNodePowerReport(precise, {
      ...configured,
      machineConfigTiers: { prassMachineCasing: "uhv" },
    });
    expect(uncapped.tier).toBe("UV");
    expect(uncapped.poolEuT).toBe(524288 * 4);
    const low = getNodePowerReport(precise, {
      ...configured,
      machineConfigTiers: { prassMachineCasing: "iv" },
    });
    expect(low.state).toBe("over-tier");
    expect(describePowerStall(low)).toContain("Machine casing voltage");
  });

  it("keeps existing voltage and amps when old plans gain the controls", () => {
    const migrated = normalizeHatchInput(
      precise,
      {
        ...node,
        hatchVoltageTier: undefined,
        hatchAmps: undefined,
        overclockTier: "UV",
        energyHatches: 2,
      },
      true,
    );
    expect(migrated.hatchVoltageTier).toBe("UV");
    expect(migrated.hatchAmps).toBe(4);
    expect(getRecipeMachineConfigTierControls(precise, migrated)[1].current.key).toBe("uhv");
  });

  it("uses the normal handler's base recipe once and leaves singleblocks alone", () => {
    const family: Recipe = {
      ...normal,
      machineType: "Assembler",
      machineHandlers: [
        {
          id: "single",
          label: "Assembler",
          machineType: "Assembler",
          kind: "single",
          minimumTier: "LV",
        },
        {
          id: "prass",
          label: normal.machineType,
          machineType: normal.machineType,
          kind: "multiblock",
          minimumTier: "UHV",
          durationTicks: 200,
          eut: 30,
        },
      ],
    };
    const selected = { ...node, machineHandlerId: "prass" };
    expect(
      getNodePowerReport(family, { ...selected, hatchVoltageTier: "LV", hatchAmps: 16 }).state,
    ).toBe("ok");
    expect(getOverclockedRecipeStats(family, selected)).toEqual(
      getOverclockedRecipeStats(normal, node),
    );
    expect(
      getRecipeMachineConfigTierControls(
        applyMachineHandlerToRecipe(family, { machineHandlerId: "single" }),
        node,
      ),
    ).toHaveLength(0);
  });

  it("stalls the solver when the machine casing cannot handle the recipe", () => {
    const configured = { ...node, machineConfigTiers: { prassMachineCasing: "iv" } };
    const project: FactoryProject = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "prass-test",
      name: "PrAss test",
      nodes: [configured],
      recipes: [precise],
      fuelProfiles: [],
      storages: [
        { id: "input", kind: "item", resourceId: "part", position: { x: -200, y: 0 } },
        { id: "output", kind: "item", resourceId: "component", position: { x: 200, y: 0 } },
      ],
      edges: [
        {
          id: "feed",
          source: "input",
          target: "machine",
          resourceKind: "item",
          resourceId: "part",
        },
        {
          id: "ship",
          source: "machine",
          target: "output",
          resourceKind: "item",
          resourceId: "component",
        },
      ],
    };
    const stopped = calculateThroughput(project);
    expect(stopped.nodes.machine.powerStalled).toBe(true);
    expect(stopped.edges.ship.transferredPerSecond).toBe(0);
    const running = calculateThroughput({ ...project, nodes: [node] });
    expect(running.nodes.machine.powerStalled).toBe(false);
    expect(running.edges.ship.transferredPerSecond).toBeGreaterThan(0);
  });
});
