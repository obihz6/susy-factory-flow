import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * LOOSE CELL WIRES: the board rule that lets a filled cell land straight on
 * its fluid's input. The wire stays an ordinary same-kind edge (its resource
 * is the CELL); the fluid it satisfies is named by its target handle, and the
 * Canner ratio rides on `crossForm`. Inside the solve it runs through a
 * hidden free Tank (`expandCrossFormEdges`), which these tests treat as a
 * black box: only the visible wire and the two real machines are asserted.
 */

function node(id: string, recipeId: string) {
  return {
    id,
    recipeId,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(id: string, resourceId: string, kind: "item" | "fluid" = "item"): FactoryStorage {
  return { id, kind, resourceId, position: { x: 0, y: 0 } };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "loose-cells",
    name: "loose-cells",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    setupRules: { looseCellWires: true },
    ...over,
  } as FactoryProject;
}

// One machine fills two water cells a second; another drinks 1000 L of water
// a second. 2 cells = 2000 L at the Canner's 1000 L ratio, so the drinker is
// fully fed and the filler runs at half pace once the spare has nowhere to go.
const FILLER = {
  id: "fill",
  name: "fill",
  machineType: "Bender",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 30,
  inputs: [],
  outputs: [{ kind: "item" as const, id: "water_cell", amount: 2 }],
};
const DRINKER = {
  id: "drink",
  name: "drink",
  machineType: "Bender",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 30,
  inputs: [{ kind: "fluid" as const, id: "water", amount: 1000 }],
  outputs: [{ kind: "item" as const, id: "sponge", amount: 1 }],
};

const CROSS_WIRE = {
  id: "w",
  source: "maker",
  target: "taker",
  sourceHandle: "output:item:water_cell",
  targetHandle: "input:fluid:water",
  resourceKind: "item" as const,
  resourceId: "water_cell",
  crossForm: { litresPerCell: 1000 },
};

describe("loose cell wires", () => {
  it("feeds a fluid input from a cell wire at the Canner ratio", () => {
    const result = calculateThroughput(
      project({
        recipes: [FILLER, DRINKER],
        nodes: [node("maker", "fill"), node("taker", "drink")],
        storages: [drawer("d", "sponge")],
        edges: [
          CROSS_WIRE,
          { id: "out", source: "taker", target: "d", resourceKind: "item", resourceId: "sponge" },
        ],
      }),
      { generatedAt: "fixed" },
    );

    // The drinker gets its full 1000 L/s, which costs one cell a second; the
    // filler's other cell has nowhere to go, so the clog holds it at 50% -
    // exactly what a real Tank card wired in between would have done.
    expect(result.nodes["taker"].utilization).toBeCloseTo(1);
    expect(result.nodes["maker"].utilization).toBeCloseTo(0.5);
    // The visible wire carries CELLS, its own resource.
    expect(result.edges["w"].transferredPerSecond).toBeCloseTo(1);
    // Nothing hidden leaks into the result.
    expect(Object.keys(result.nodes).sort()).toEqual(["maker", "taker"]);
    expect(Object.keys(result.edges).sort()).toEqual(["out", "w"]);
  });

  it("passes demand upstream through the conversion", () => {
    // Same board plus a byproduct drawer catching the spare cells: now the
    // filler runs flat out and the drinker still drinks exactly 1000 L/s.
    const result = calculateThroughput(
      project({
        recipes: [FILLER, DRINKER],
        nodes: [node("maker", "fill"), node("taker", "drink")],
        storages: [
          drawer("d", "sponge"),
          { ...drawer("spare", "water_cell"), drainMode: "byproduct" as const },
        ],
        edges: [
          CROSS_WIRE,
          { id: "out", source: "taker", target: "d", resourceKind: "item", resourceId: "sponge" },
          {
            id: "catch",
            source: "maker",
            target: "spare",
            resourceKind: "item",
            resourceId: "water_cell",
          },
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["maker"].utilization).toBeCloseTo(1);
    expect(result.nodes["taker"].utilization).toBeCloseTo(1);
    expect(result.edges["w"].transferredPerSecond).toBeCloseTo(1);
    expect(result.edges["catch"].transferredPerSecond).toBeCloseTo(1);
  });

  it("fills a cell input from a fluid wire at the Canner ratio", () => {
    // The mirror shape: a pump makes 2000 L of water a second, a machine
    // eats one water cell a second. The wire carries the FLUID and lands on
    // the cell input; the hidden Tank fills cells at 1000 L each, so the
    // eater runs flat out and the pump holds at 50% when the spare litres
    // have nowhere to go.
    const PUMP = {
      id: "pump",
      name: "pump",
      machineType: "Bender",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 30,
      inputs: [],
      outputs: [{ kind: "fluid" as const, id: "water", amount: 2000 }],
    };
    const EATER = {
      id: "eat",
      name: "eat",
      machineType: "Bender",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 30,
      inputs: [{ kind: "item" as const, id: "water_cell", amount: 1 }],
      outputs: [{ kind: "item" as const, id: "sponge", amount: 1 }],
    };
    const result = calculateThroughput(
      project({
        recipes: [PUMP, EATER],
        nodes: [node("maker", "pump"), node("taker", "eat")],
        storages: [drawer("d", "sponge")],
        edges: [
          {
            id: "w",
            source: "maker",
            target: "taker",
            sourceHandle: "output:fluid:water",
            targetHandle: "input:item:water_cell",
            resourceKind: "fluid",
            resourceId: "water",
            crossForm: { litresPerCell: 1000 },
          },
          { id: "out", source: "taker", target: "d", resourceKind: "item", resourceId: "sponge" },
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["taker"].utilization).toBeCloseTo(1);
    expect(result.nodes["maker"].utilization).toBeCloseTo(0.5);
    // The visible wire carries LITRES, its own resource.
    expect(result.edges["w"].transferredPerSecond).toBeCloseTo(1000);
    expect(Object.keys(result.nodes).sort()).toEqual(["maker", "taker"]);
    expect(Object.keys(result.edges).sort()).toEqual(["out", "w"]);
  });

  it("a cross-form wire carries nothing once the rule is turned off", () => {
    // The wire and its ratio survive on the board, but with looseCellWires
    // off the conversion does not exist: the drinker reads unsupplied, same
    // as if the wire were not there. Turning the rule back on revives it.
    const result = calculateThroughput(
      project({
        setupRules: { looseCellWires: false },
        recipes: [FILLER, DRINKER],
        nodes: [node("maker", "fill"), node("taker", "drink")],
        storages: [drawer("d", "sponge")],
        edges: [
          CROSS_WIRE,
          { id: "out", source: "taker", target: "d", resourceKind: "item", resourceId: "sponge" },
        ],
      }),
      { generatedAt: "fixed" },
    );

    expect(result.nodes["taker"].utilization).toBeCloseTo(0);
  });

  it("an edge without the ratio stays inert instead of inventing one", () => {
    const result = calculateThroughput(
      project({
        recipes: [FILLER, DRINKER],
        nodes: [node("maker", "fill"), node("taker", "drink")],
        storages: [drawer("d", "sponge")],
        edges: [
          { ...CROSS_WIRE, crossForm: undefined },
          { id: "out", source: "taker", target: "d", resourceKind: "item", resourceId: "sponge" },
        ],
      }),
      { generatedAt: "fixed" },
    );

    // A kind-mismatched wire with no stored ratio converts nothing.
    expect(result.nodes["taker"].utilization).toBeCloseTo(0);
  });
});
