import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type SetupRules, type FactoryProject } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * The board rules: FREE INPUTS feeds anything short of stock, FREE OUTPUTS
 * lets anything with nowhere to go leave. Each is exactly what wiring a
 * source onto every input, or a product drawer onto every output, would do -
 * WIRED slots included, which is the whole difference from the sketch mode
 * they replaced. The virtual drawers never reach the board, and anything the
 * player did wire still carries its real flow.
 */

const RECIPES = [
  {
    id: "smelt",
    name: "smelt",
    machineType: "Furnace",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [{ kind: "item" as const, id: "ore", amount: 2 }],
    outputs: [{ kind: "item" as const, id: "ingot", amount: 1 }],
  },
  {
    id: "press",
    name: "press",
    machineType: "Bender",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: [{ kind: "item" as const, id: "ingot", amount: 1 }],
    outputs: [{ kind: "item" as const, id: "plate", amount: 1 }],
  },
];

function machine(id: string, recipeId: string, machineCount: number, x: number) {
  return {
    id,
    recipeId,
    machineCount,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x, y: 0 },
  };
}

/** Smelter -> presser on one wire, and nothing else declared. */
function board(rules: SetupRules | undefined, smelters = 1, pressers = 1): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "rules",
    name: "rules",
    setupRules: rules,
    recipes: RECIPES,
    nodes: [machine("smelter", "smelt", smelters, 0), machine("presser", "press", pressers, 300)],
    edges: [
      {
        id: "mid",
        source: "smelter",
        target: "presser",
        resourceKind: "item",
        resourceId: "ingot",
      },
    ],
    fuelProfiles: [],
  } as FactoryProject;
}

/**
 * The same chain with its far ends DECLARED: an ore source into the smelter,
 * a plate product off the presser. A closed plan, so the only thing left to
 * go wrong is the wire in the middle - which is what the two rules are for.
 */
function closedChain(
  rules: SetupRules | undefined,
  smelters = 1,
  pressers = 1,
): FactoryProject {
  const base = board(rules, smelters, pressers);
  return {
    ...base,
    storages: [
      { id: "ore-source", kind: "item", resourceId: "ore", position: { x: -300, y: 0 } },
      { id: "plate-out", kind: "item", resourceId: "plate", position: { x: 600, y: 0 } },
    ],
    edges: [
      ...base.edges,
      {
        id: "feed",
        source: "ore-source",
        target: "smelter",
        resourceKind: "item",
        resourceId: "ore",
      },
      {
        id: "ship",
        source: "presser",
        target: "plate-out",
        resourceKind: "item",
        resourceId: "plate",
      },
    ],
  } as FactoryProject;
}

const solve = (project: FactoryProject) => calculateThroughput(project, { generatedAt: "fixed" });

describe("board rules", () => {
  it("a half-wired chain reads zero with both rules off", () => {
    const result = solve(board(undefined));
    expect(result.nodes["smelter"].utilization).toBeCloseTo(0);
    expect(result.nodes["presser"].utilization).toBeCloseTo(0);
  });

  it("both rules on run the chain flat out, and the wire still carries it", () => {
    const result = solve(board({ freeInputs: true, freeOutputs: true }));
    expect(result.nodes["smelter"].utilization).toBeCloseTo(1);
    expect(result.nodes["presser"].utilization).toBeCloseTo(1);
    expect(result.edges["mid"].transferredPerSecond).toBeCloseTo(1);
  });

  it("a legacy sketch-mode plan opens as both rules", () => {
    const legacy = { ...board(undefined), assumeBoundaries: true } as FactoryProject;
    expect(solve(legacy).nodes["presser"].utilization).toBeCloseTo(1);
  });

  it("free inputs alone still leaves the bare plate slot to pin the chain", () => {
    // The presser's plate has nowhere to go, so conservation pins it, and the
    // smelter feeding it goes down too. Free inputs answers where things come
    // FROM and nothing else.
    const result = solve(board({ freeInputs: true }));
    expect(result.nodes["presser"].utilization).toBeCloseTo(0);
    expect(result.nodes["smelter"].utilization).toBeCloseTo(0);
  });

  it("free outputs alone still leaves the bare ore slot to pin the chain", () => {
    const result = solve(board({ freeOutputs: true }));
    expect(result.nodes["smelter"].utilization).toBeCloseTo(0);
    expect(result.nodes["presser"].utilization).toBeCloseTo(0);
  });

  it("free outputs unclogs a WIRED port, which sketch mode never did", () => {
    // Two smelters make 2 ingots/s into one presser that eats 1. The wire is
    // drawn, so the bare-slot rule sketch mode used would not have touched it.
    expect(solve(closedChain(undefined, 2, 1)).nodes["smelter"].utilization).toBeCloseTo(0.5);
    const freed = solve(closedChain({ freeOutputs: true }, 2, 1));
    expect(freed.nodes["smelter"].utilization).toBeCloseTo(1);
    expect(freed.nodes["presser"].utilization).toBeCloseTo(1);
    // The presser is still fed off the wire, not off a free source.
    expect(freed.edges["mid"].transferredPerSecond).toBeCloseTo(1);
  });

  it("free inputs tops up a WIRED port that cannot keep up", () => {
    // One smelter makes 1 ingot/s into two pressers that want 2 between them.
    expect(solve(closedChain(undefined, 1, 2)).nodes["presser"].utilization).toBeCloseTo(0.5);
    const fed = solve(closedChain({ freeInputs: true }, 1, 2));
    expect(fed.nodes["presser"].utilization).toBeCloseTo(1);
    // Everything the smelter makes still goes down the wire; only the
    // shortfall is imported.
    expect(fed.edges["mid"].transferredPerSecond).toBeCloseTo(1);
  });
});
