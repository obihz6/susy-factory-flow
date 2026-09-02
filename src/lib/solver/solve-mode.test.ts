import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type FactoryStorage } from "@/lib/model/types";
import { calculateThroughput } from "./throughput";

/**
 * Solve mode's exam, through the production path. One op per second per
 * machine (20-tick recipes), so amounts read as rates and the solved
 * machine count is the target divided by the per-machine rate.
 */

function recipe(id: string, inputs: [string, number][], outputs: [string, number][]) {
  return {
    id,
    name: id,
    machineType: "Lab Machine",
    minimumTier: "LV",
    durationTicks: 20,
    eut: 30,
    inputs: inputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
    outputs: outputs.map(([itemId, amount]) => ({ kind: "item" as const, id: itemId, amount })),
  };
}

function node(id: string, recipeId: string, machineCount = 1) {
  return {
    id,
    recipeId,
    machineCount,
    parallel: 1,
    overclockTier: "LV",
    enabled: true,
    position: { x: 0, y: 0 },
  };
}

function drawer(id: string, resourceId: string, extra?: Partial<FactoryStorage>): FactoryStorage {
  return { id, kind: "item", resourceId, position: { x: 0, y: 0 }, ...extra };
}

let edgeSeq = 0;
function wire(source: string, target: string, resourceId: string) {
  edgeSeq += 1;
  return { id: `sm${edgeSeq}`, source, target, resourceKind: "item" as const, resourceId };
}

function project(over: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "solve-exam",
    name: "solve-exam",
    solveMode: true,
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...over,
  } as FactoryProject;
}

describe("solve mode", () => {
  it("scales a chain to exactly the typed amount", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit", { targetPerSecond: 3 })],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(3, 5);
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(3, 5);
    expect(result.storages["out"]!.producedPerSecond).toBeCloseTo(3, 5);
    expect(result.storages["out"]!.targetUnreachable).toBeUndefined();
    // Scaled books: EU rides the solved counts, 3x of two 30 EU/t machines.
    expect(result.totalEuT).toBeCloseTo(180, 4);
  });

  it("counts machines by recipe ratio, fractions allowed", () => {
    // make yields 10 gear per op, use eats 5: two kits per second wants use
    // at x2 and make at x1.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 10]]), recipe("use", [["gear", 5]], [["kit", 1]])],
        nodes: [node("a", "make"), node("b", "use")],
        storages: [drawer("src", "ore"), drawer("out", "kit", { targetPerSecond: 2 })],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(1, 5);
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
  });

  it("built counts are the unit, not the ceiling: a half machine is a half", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make", 4)],
        storages: [drawer("src", "ore"), drawer("out", "gear", { targetPerSecond: 2 })],
        edges: [wire("src", "a", "ore"), wire("a", "out", "gear")],
      }),
      { generatedAt: "fixed" },
    );
    // 4 built, each 1/s; 2/s needs 2 machines whatever was built.
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
  });

  it("a chain no target needs solves to zero machines, and its wires stay", () => {
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("make", [["ore", 1]], [["gear", 1]]),
          recipe("brew", [["water", 1]], [["kit", 1]]),
        ],
        nodes: [node("a", "make"), node("b", "brew")],
        storages: [
          drawer("src", "ore"),
          drawer("out", "gear"),
          drawer("w", "water"),
          drawer("k", "kit", { targetPerSecond: 1 }),
        ],
        edges: [
          wire("src", "a", "ore"),
          wire("a", "out", "gear"),
          wire("w", "b", "water"),
          wire("b", "k", "kit"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(0, 5);
    expect(result.nodes["a"]!.utilization).toBe(0);
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(1, 5);
    // The idle chain's wires still carry results (at zero), never vanish.
    expect(Object.keys(result.edges).length).toBe(4);
    // And the idle machine keeps its NAMEPLATE port rates: the card's port
    // rows (and the React Flow handles its wires dock on) are built from
    // these flows, so zeroing them made the card shed its ports and its
    // wires stop drawing. Utilization 0 is the only zero.
    const idleOutputs = Object.values(result.nodes["a"]!.outputs);
    expect(idleOutputs.length).toBeGreaterThan(0);
    expect(idleOutputs[0]!.amountPerSecond).toBeGreaterThan(0);
  });

  it("a byproduct drawer catches the ratio's forced overshoot", () => {
    // Every op makes 1 kit and 2 slag. Two kits per second necessarily
    // makes four slag per second; the byproduct drawer reads the spare.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["kit", 1], ["slag", 2]])],
        nodes: [node("a", "make")],
        storages: [
          drawer("src", "ore"),
          drawer("out", "kit", { targetPerSecond: 2 }),
          drawer("spare", "slag", { drainMode: "byproduct" }),
        ],
        edges: [wire("src", "a", "ore"), wire("a", "out", "kit"), wire("a", "spare", "slag")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
    expect(result.storages["spare"]!.producedPerSecond).toBeCloseTo(4, 5);
  });

  it("targets are minimums when two share one recipe's fixed ratio", () => {
    // The distillation shape: one op makes 1 heavy and 4 light. Asking for
    // 2 heavy and 1 light runs the tower for the heavy; the light target is
    // met with surplus rather than reported broken.
    const result = calculateThroughput(
      project({
        recipes: [recipe("still", [["oil", 1]], [["heavy", 1], ["light", 4]])],
        nodes: [node("a", "still")],
        storages: [
          drawer("src", "oil"),
          drawer("h", "heavy", { targetPerSecond: 2 }),
          drawer("l", "light", { targetPerSecond: 1 }),
        ],
        edges: [wire("src", "a", "oil"), wire("a", "h", "heavy"), wire("a", "l", "light")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
    expect(result.storages["h"]!.producedPerSecond).toBeCloseTo(2, 5);
    expect(result.storages["l"]!.producedPerSecond).toBeCloseTo(8, 5);
    expect(result.storages["h"]!.targetUnreachable).toBeUndefined();
    expect(result.storages["l"]!.targetUnreachable).toBeUndefined();
  });

  it("names an unreachable target and still solves the rest", () => {
    // The gear chain's maker has a bare ore input (no source wire), so no
    // machine scale reaches the gear target; the kit chain still solves.
    const result = calculateThroughput(
      project({
        recipes: [
          recipe("make", [["ore", 1]], [["gear", 1]]),
          recipe("brew", [["water", 1]], [["kit", 1]]),
        ],
        nodes: [node("a", "make"), node("b", "brew")],
        storages: [
          drawer("w", "water"),
          drawer("g", "gear", { targetPerSecond: 1 }),
          drawer("k", "kit", { targetPerSecond: 2 }),
        ],
        edges: [wire("a", "g", "gear"), wire("w", "b", "water"), wire("b", "k", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.storages["g"]!.targetUnreachable).toBe(true);
    expect(result.storages["k"]!.targetUnreachable).toBeUndefined();
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
    expect(result.bottlenecks.some((b) => b.id === "solve-target:g")).toBe(true);
  });

  it("a pinned count with no targets drives the whole line", () => {
    // "I want 3 assemblers running; solve the rest": the lathe scales to
    // feed them and the product drawer reads what falls out.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 2]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [node("a", "make"), { ...node("b", "use"), solvePin: 3 }],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    // b pinned at 3 machines eats 3 gear/s; a makes 2 gear/s per machine.
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(3, 5);
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(1.5, 5);
    expect(result.storages["out"]!.producedPerSecond).toBeCloseTo(3, 5);
  });

  it("a pin and a target solve together, the bigger ask winning the shared chain", () => {
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 2]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [{ ...node("a", "make"), solvePin: 4 }, node("b", "use")],
        storages: [
          drawer("src", "ore"),
          drawer("out", "kit", { targetPerSecond: 2 }),
          drawer("spare", "gear", { drainMode: "byproduct" }),
        ],
        edges: [
          wire("src", "a", "ore"),
          wire("a", "b", "gear"),
          wire("a", "spare", "gear"),
          wire("b", "out", "kit"),
        ],
      }),
      { generatedAt: "fixed" },
    );
    // a pinned at 4 makes 8 gear/s; the kit target needs 2 machines of b
    // eating 2 gear/s; the byproduct drawer catches the other 6.
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(4, 5);
    expect(result.nodes["b"]!.theoreticalMachinesRequired).toBeCloseTo(2, 5);
    expect(result.storages["spare"]!.producedPerSecond).toBeCloseTo(6, 5);
  });

  it("pins that cannot run together say so instead of zeroing silently", () => {
    // The pinned machine's only outlet is a machine pinned too low to eat
    // its output: the equality cannot hold at any flow.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 2]]), recipe("use", [["gear", 1]], [["kit", 1]])],
        nodes: [
          { ...node("a", "make"), solvePin: 4 },
          { ...node("b", "use"), solvePin: 1 },
        ],
        storages: [drawer("src", "ore"), drawer("out", "kit")],
        edges: [wire("src", "a", "ore"), wire("a", "b", "gear"), wire("b", "out", "kit")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.bottlenecks.some((b) => b.id === "solve-pins")).toBe(true);
  });

  it("no numbers typed anywhere: nothing asks, so nothing runs", () => {
    // The honest zero, not the plan books - showing plan figures inside
    // solve mode read as machines running for no reason. The cards keep
    // their shape (nameplate ports, wires drawn at zero) and the UI's
    // needs-a-number notice explains; here the books just say zero.
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make")],
        storages: [drawer("src", "ore"), drawer("out", "gear")],
        edges: [wire("src", "a", "ore"), wire("a", "out", "gear")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.utilization).toBe(0);
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(0, 5);
    expect(Object.values(result.nodes["a"]!.outputs)[0]!.amountPerSecond).toBeGreaterThan(0);
    expect(Object.keys(result.edges).length).toBe(2);
    expect(result.bottlenecks.some((b) => b.id.startsWith("solve-target:"))).toBe(false);
  });

  it("a byproduct drawer's dormant number asks nothing", () => {
    // Typed while the drawer was a product, kept for the flip back: it
    // must not run the chain (Jack's chlorine board, 2026-08-31).
    const result = calculateThroughput(
      project({
        recipes: [recipe("make", [["ore", 1]], [["gear", 1]])],
        nodes: [node("a", "make")],
        storages: [
          drawer("src", "ore"),
          drawer("out", "gear", { drainMode: "byproduct", targetPerSecond: 5 }),
        ],
        edges: [wire("src", "a", "ore"), wire("a", "out", "gear")],
      }),
      { generatedAt: "fixed" },
    );
    expect(result.nodes["a"]!.utilization).toBe(0);
    expect(result.nodes["a"]!.theoreticalMachinesRequired).toBeCloseTo(0, 5);
  });
});
