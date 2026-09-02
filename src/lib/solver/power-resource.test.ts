import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * EU as a resource, through the production path: a generator-shaped recipe
 * (fuel in, power:eu out, one op per second) wired - or not - into drawers.
 * The one rule of its own: the closed-plan rule waives an UNWIRED power
 * output, because unbanked EU dissipates in game instead of stalling the
 * generator.
 */

function generatorRecipe(id: string, euPerSecond: number) {
  return {
    id,
    name: id,
    kind: "custom" as const,
    machineType: "Generator",
    minimumTier: "NONE",
    durationTicks: 20,
    eut: 0,
    inputs: [{ kind: "fluid" as const, id: "fuel", amount: 10, displayName: "fuel" }],
    outputs: [
      { kind: "power" as const, id: "eu", amount: euPerSecond, displayName: "EU", byproduct: true },
    ],
  };
}

function node(id: string, recipeId: string, machineCount = 1) {
  return {
    id,
    recipeId,
    machineCount,
    parallel: 1,
    overclockTier: "NONE",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(
  id: string,
  kind: "fluid" | "power",
  resourceId: string,
  extra?: Partial<FactoryStorage>,
): FactoryStorage {
  return { id, kind, resourceId, position: { x: 0, y: 0 }, ...extra };
}

let edgeSeq = 0;
function wire(source: string, target: string, resourceKind: "fluid" | "power", resourceId: string) {
  edgeSeq += 1;
  return { id: `pw${edgeSeq}`, source, target, resourceKind, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "power-exam",
    name: "power-exam",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

describe("power as a resource", () => {
  it("an unwired EU output does not pin its generator", () => {
    // The closed-plan rule normally zeroes a machine with a bare output
    // port; EU dissipates instead, so a fed generator runs.
    const result = calculateThroughput(
      project({
        recipes: [generatorRecipe("gen", 640)],
        nodes: [node("g", "gen")],
        storages: [drawer("src", "fluid", "fuel")],
        edges: [wire("src", "g", "fluid", "fuel")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["g"]!.utilization).toBeCloseTo(1, 5);
  });

  it("a wired EU drawer banks the generator's output", () => {
    const result = calculateThroughput(
      project({
        recipes: [generatorRecipe("gen", 640)],
        nodes: [node("g", "gen")],
        storages: [drawer("src", "fluid", "fuel"), drawer("bank", "power", "eu")],
        edges: [wire("src", "g", "fluid", "fuel"), wire("g", "bank", "power", "eu")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["g"]!.utilization).toBeCloseTo(1, 5);
    expect(result.storages["bank"]!.producedPerSecond).toBeCloseTo(640, 4);
    // EU stays out of the resource books: not an item, never an
    // INPUTS/OUTPUTS row. The MACHINES panel's MADE column accounts it.
    expect(result.resources["power:eu"]).toBeUndefined();
    expect(result.unconsumedOutputs.some((b) => b.kind === "power")).toBe(false);
  });

  it("solve mode: a typed EU amount solves the generator count and its fuel", () => {
    // 640 EU/s per generator (32 EU/t); asking for 1600 EU/s (80 EU/t)
    // wants x2.5 generators drinking 25 fuel/s.
    const result = calculateThroughput(
      project({
        solveMode: true,
        recipes: [generatorRecipe("gen", 640)],
        nodes: [node("g", "gen")],
        storages: [
          drawer("src", "fluid", "fuel"),
          drawer("bank", "power", "eu", { targetPerSecond: 1600 }),
        ],
        edges: [wire("src", "g", "fluid", "fuel"), wire("g", "bank", "power", "eu")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["g"]!.theoreticalMachinesRequired).toBeCloseTo(2.5, 5);
    expect(result.storages["bank"]!.producedPerSecond).toBeCloseTo(1600, 4);
    expect(result.resources["fluid:fuel"]!.consumedPerSecond).toBeCloseTo(25, 4);
  });

  it("solve mode: an unwired EU port does not pin a generator another target needs", () => {
    // The generator also makes a material byproduct a target wants; its
    // bare EU port must not zero it in the solve either.
    const recipe = {
      ...generatorRecipe("gen", 640),
      outputs: [
        ...generatorRecipe("gen", 640).outputs,
        { kind: "item" as const, id: "ash", amount: 1, displayName: "ash" },
      ],
    };
    const result = calculateThroughput(
      project({
        solveMode: true,
        recipes: [recipe],
        nodes: [node("g", "gen")],
        storages: [
          drawer("src", "fluid", "fuel"),
          { id: "s-ash", kind: "item", resourceId: "ash", position: { x: 0, y: 0 }, targetPerSecond: 2 },
        ],
        edges: [
          wire("src", "g", "fluid", "fuel"),
          { id: "pw-ash", source: "g", target: "s-ash", resourceKind: "item" as const, resourceId: "ash" },
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["g"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
  });
});
