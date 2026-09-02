import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "@/lib/solver/throughput";
import { buildPowerRecipe } from "./power-recipe";

/**
 * The workbook's own Fluid Reactor scenario, WIRED and SOLVED end to end:
 * one IC2 reactor (design 2, 1,380 L/s hot coolant) into one Large Heat
 * Exchanger (tier 1) - which the sheet prints as 13,800 L/t of superheated
 * steam - coolant looping back, and the steam into eight Large HP Steam
 * Turbines (Shadow Metal / Small / tight / optimal: 1,600 L/t and 1,520
 * EU/t each). The books must carry the sheet's numbers across the wires.
 */
function node(id: string, recipeId: string, machineCount = 1, settings?: Record<string, string>) {
  return {
    id,
    recipeId,
    machineCount,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
    machineConfigTiers: settings,
  };
}

describe("power chain against the workbook", () => {
  it("carries reactor -> LHE -> HP turbines at the sheet's printed rates", () => {
    const reactorSettings = { design: "design-2" };
    const lheSettings = { fluid: "Hot Coolant", intake: "1380", tier: "1" };
    const turbineSettings = {
      rotor: "Shadow Metal",
      size: "Small",
      fitting: "tight",
      flowMode: "optimal",
    };
    const recipes = [
      buildPowerRecipe("ic2-fluid-reactor", reactorSettings, "r-reactor")!,
      buildPowerRecipe("large-heat-exchanger", lheSettings, "r-lhe")!,
      buildPowerRecipe("large-hp-steam-turbine", turbineSettings, "r-turbine")!,
    ];

    // The synthesized recipes alone must already speak the sheet's numbers.
    expect(recipes[1].outputs.find((o) => o.id === "ic2superheatedsteam")?.amount).toBeCloseTo(
      276_000,
    );
    expect(recipes[2].inputs.find((i) => i.id === "ic2superheatedsteam")?.amount).toBeCloseTo(
      32_000,
    );
    expect(recipes[2].power?.euPerTick).toBe(1520);

    const project = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "power-chain",
      name: "power-chain",
      recipes,
      nodes: [
        node("reactor", "r-reactor", 1, reactorSettings),
        node("lhe", "r-lhe", 1, lheSettings),
        node("turbine", "r-turbine", 8, turbineSettings),
      ],
      edges: [
        {
          id: "e-hot",
          source: "reactor",
          target: "lhe",
          resourceKind: "fluid" as const,
          resourceId: "ic2hotcoolant",
        },
        {
          id: "e-cold",
          source: "lhe",
          target: "reactor",
          resourceKind: "fluid" as const,
          resourceId: "ic2coolant",
        },
        {
          id: "e-sh",
          source: "lhe",
          target: "turbine",
          resourceKind: "fluid" as const,
          resourceId: "ic2superheatedsteam",
        },
      ],
      fuelProfiles: [],
      setupRules: { freeInputs: true, freeOutputs: true },
    } as unknown as FactoryProject;

    const result = calculateThroughput(project, { generatedAt: "fixed" });

    // Everything runs flat out: 276,000 L/s of steam covers the turbines'
    // 256,000 with room to spare, and free outputs carry the surplus.
    expect(result.nodes["reactor"].utilization).toBeCloseTo(1);
    expect(result.nodes["lhe"].utilization).toBeCloseTo(1);
    expect(result.nodes["turbine"].utilization).toBeCloseTo(1);
    // The coolant loop at the sheet's 1,380 L/s, both directions.
    expect(result.edges["e-hot"].transferredPerSecond).toBeCloseTo(1380);
    expect(result.edges["e-cold"].transferredPerSecond).toBeCloseTo(1380);
    // Eight turbines at their 1,600 L/t optimal = 256,000 L/s off the wire.
    expect(result.edges["e-sh"].transferredPerSecond).toBeCloseTo(256_000);
  });
});
