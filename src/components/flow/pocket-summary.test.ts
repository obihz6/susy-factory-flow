import { describe, expect, it } from "vitest";
import { calculateThroughput } from "@/lib/solver";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import {
  computePocketSummaries,
  countPocketCrossings,
  pocketCardHeight,
} from "./pocket-summary";

/**
 * A board holding its OWN source: a mine that needs nothing, feeding a
 * smelter, whose plates leave for a machine outside. The old card ran a
 * members-only solve and called this starving; nothing crosses the border
 * on the way in, so the summary must say so and simply report the plates
 * going out.
 */
function makeSelfFedBoard(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "board-summary-project",
    name: "Board summary test",
    recipes: [
      {
        id: "mine",
        name: "Mine",
        machineType: "Ore Drill",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [],
        outputs: [{ kind: "item", id: "iron_ore", amount: 1 }],
      },
      {
        id: "smelt",
        name: "Smelt",
        machineType: "Electric Furnace",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "iron_ore", amount: 1 }],
        outputs: [{ kind: "item", id: "iron_plate", amount: 1 }],
      },
      {
        id: "assemble",
        name: "Assemble",
        machineType: "Assembler",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 30,
        inputs: [{ kind: "item", id: "iron_plate", amount: 1 }],
        // Nothing comes back out of it, so the chain has somewhere to put
        // its plates and the whole board runs.
        outputs: [],
      },
    ],
    nodes: [
      {
        id: "mine-1",
        recipeId: "mine",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
        pocketId: "board-1",
      },
      {
        id: "smelter",
        recipeId: "smelt",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 300, y: 0 },
        pocketId: "board-1",
      },
      {
        id: "assembler",
        recipeId: "assemble",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 900, y: 0 },
      },
    ],
    edges: [
      {
        id: "e-ore",
        source: "mine-1",
        target: "smelter",
        resourceKind: "item",
        resourceId: "iron_ore",
      },
      {
        id: "e-plate",
        source: "smelter",
        target: "assembler",
        resourceKind: "item",
        resourceId: "iron_plate",
      },
    ],
    storages: [],
    annotations: [],
    pockets: [{ id: "board-1", name: "Plates", position: { x: 0, y: 0 } }],
    fuelProfiles: [],
  };
}

describe("computePocketSummaries", () => {
  it("reports what crosses the border and never claims a shortage", () => {
    const project = makeSelfFedBoard();
    const result = calculateThroughput(project);
    const summary = computePocketSummaries(project, project.pockets ?? [], result).get("board-1");

    expect(summary).toBeDefined();
    // The ore never leaves the board, so it is not a border crossing — and
    // the board with its own source asks the outside world for nothing.
    expect(summary!.incoming).toEqual([]);
    expect(summary!.outgoing.map((crossing) => crossing.resourceId)).toEqual(["iron_plate"]);
    expect(summary!.outgoing[0]!.ratePerSecond).toBeGreaterThan(0);
    expect(summary!.outgoing[0]!.wireCount).toBe(1);

    expect(summary!.machineCount).toBe(2);
    expect(summary!.memberCount).toBe(2);
    expect(summary!.euPerTick).toBeGreaterThan(0);
  });

  it("reads zero rather than guessing when the plan has not been solved", () => {
    const project = makeSelfFedBoard();
    const summary = computePocketSummaries(project, project.pockets ?? []).get("board-1");
    expect(summary!.outgoing.map((crossing) => crossing.ratePerSecond)).toEqual([0]);
  });

  it("folds several wires carrying one resource into one line", () => {
    const project = makeSelfFedBoard();
    project.nodes.push({
      id: "assembler-2",
      recipeId: "assemble",
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 900, y: 400 },
    });
    project.edges.push({
      id: "e-plate-2",
      source: "smelter",
      target: "assembler-2",
      resourceKind: "item",
      resourceId: "iron_plate",
    });

    const summary = computePocketSummaries(
      project,
      project.pockets ?? [],
      calculateThroughput(project),
    ).get("board-1");
    expect(summary!.outgoing).toHaveLength(1);
    expect(summary!.outgoing[0]!.wireCount).toBe(2);
  });

  it("says what the contents need and make, wires ignored", () => {
    const project = makeSelfFedBoard();
    const summary = computePocketSummaries(
      project,
      project.pockets ?? [],
      calculateThroughput(project),
    ).get("board-1");

    // The mine covers the ore, so the board asks the world for nothing:
    // this is the case the old scoped solve called starving.
    expect(summary!.needs).toEqual([]);
    expect(summary!.offers.map((line) => line.resourceId)).toEqual(["iron_plate"]);
    expect(summary!.offers[0]!.ratePerSecond).toBeGreaterThan(0);
  });

  it("nets a part-covered ingredient down to what is really missing", () => {
    const project = makeSelfFedBoard();
    // A second smelter inside eats more ore than the one mine makes.
    project.nodes.push({
      id: "smelter-2",
      recipeId: "smelt",
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: 300, y: 400 },
      pocketId: "board-1",
    });

    const lines = countPocketCrossings(project, "board-1");
    expect(lines.needs).toBe(1);
    expect(lines.offers).toBe(1);
  });

  it("still names what a stalled board needs", () => {
    const project = makeSelfFedBoard();
    // Take the mine away: the smelter inside now has nothing to eat and
    // stops. Its need is exactly what the card has to say out loud.
    project.nodes = project.nodes.filter((node) => node.id !== "mine-1");
    project.edges = project.edges.filter((edge) => edge.id !== "e-ore");

    const summary = computePocketSummaries(
      project,
      project.pockets ?? [],
      calculateThroughput(project),
    ).get("board-1");

    expect(summary!.needs.map((line) => line.resourceId)).toEqual(["iron_ore"]);
    expect(summary!.needs[0]!.ratePerSecond).toBeGreaterThan(0);
  });

  it("counts every list without a solve, for the arranger", () => {
    expect(countPocketCrossings(makeSelfFedBoard(), "board-1")).toEqual({
      needs: 0,
      offers: 1,
      incoming: 0,
      outgoing: 1,
    });
  });
});

describe("pocketCardHeight", () => {
  const lines = (
    needs: number,
    offers: number,
    incoming: number,
    outgoing: number,
  ) => ({ needs, offers, incoming, outgoing });

  it("stands on whole grid cells", () => {
    for (const shape of [
      lines(0, 0, 0, 0),
      lines(1, 0, 0, 0),
      lines(0, 0, 3, 2),
      lines(2, 3, 4, 1),
      lines(9, 9, 9, 9),
    ]) {
      expect(pocketCardHeight(shape) % 20).toBe(0);
    }
  });

  it("charges for each section only when it has something to say", () => {
    const empty = pocketCardHeight(lines(0, 0, 0, 0));
    const oneSection = pocketCardHeight(lines(0, 0, 1, 0));
    const twoSections = pocketCardHeight(lines(1, 0, 1, 0));
    expect(twoSections).toBeGreaterThan(oneSection);
    expect(oneSection).toBeGreaterThanOrEqual(empty);
  });

  it("grows with the busier side, and hides nothing", () => {
    expect(pocketCardHeight(lines(0, 0, 2, 1))).toBeGreaterThan(
      pocketCardHeight(lines(0, 0, 1, 1)),
    );
    // Every line is drawn, however many there are: one row each, forever.
    const one = pocketCardHeight(lines(0, 0, 1, 0));
    expect(pocketCardHeight(lines(0, 0, 9, 0))).toBe(one + 8 * 40);
    expect(pocketCardHeight(lines(0, 0, 40, 0))).toBe(one + 39 * 40);
  });
});
