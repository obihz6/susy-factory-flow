import { describe, expect, it } from "vitest";
import type { FactoryProject, ThroughputResult } from "../model/types";
import { calculateThroughput } from "./throughput";
import { calculateSupplyShortfalls } from "./supply-shortfall";
import { getMemoizedSupplyShortfalls } from "./supply-shortfall";

function project(overrides: Partial<FactoryProject> = {}): FactoryProject {
  return {
    schemaVersion: 1,
    id: "shortfall",
    name: "Shortfall test",
    recipes: [],
    nodes: [],
    edges: [],
    fuelProfiles: [],
    ...overrides,
  } as FactoryProject;
}

function flow(resourceId: string, amountPerSecond: number) {
  const key = `item:${resourceId}` as const;
  return { key, kind: "item" as const, resourceId, displayName: resourceId, amountPerSecond };
}

function node(nodeId: string, inputs: Record<string, ReturnType<typeof flow>>, utilization = 1) {
  return {
    nodeId,
    recipeId: nodeId,
    recipeName: nodeId,
    enabled: true,
    operationRatePerSecond: 1,
    inputs,
    outputs: {},
    euT: 0,
    requiredRatePerSecond: 0,
    maxRatePerSecond: 1,
    utilization,
    theoreticalMachinesRequired: 1,
    status: "balanced" as const,
    warnings: [],
  };
}

function result(
  nodes: ThroughputResult["nodes"],
  edges: Record<string, Partial<ThroughputResult["edges"][string]>> = {},
): ThroughputResult {
  return {
    nodes,
    edges: Object.fromEntries(
      Object.entries(edges).map(([id, edge]) => [
        id,
        {
          edgeId: id,
          resource: flow("ore", 0),
          demandPerSecond: 0,
          transferredPerSecond: 0,
          isLimited: false,
          nameplateDemandPerSecond: 0,
          sourceCapacityPerSecond: 0,
          constraint: "full",
          ...edge,
        },
      ]),
    ),
    storages: {},
    resources: {},
    totalEuT: 0,
    totalEuPerSecond: 0,
    bottlenecks: [],
    externalInputs: [],
    unconsumedOutputs: [],
    generatedAt: "test",
  } as ThroughputResult;
}

const consumer = {
  id: "consumer",
  recipeId: "consumer",
  machineCount: 1,
  parallel: 1,
  overclockTier: "ULV",
  enabled: true,
  position: { x: 0, y: 0 },
};
const consumerRecipe = {
  id: "consumer",
  name: "Consumer",
  machineType: "Consumer",
  minimumTier: "LV",
  durationTicks: 20,
  eut: 0,
  inputs: [{ kind: "item" as const, id: "ore", amount: 10 }],
  outputs: [{ kind: "item" as const, id: "product", amount: 1 }],
};

const inputEdge = (id: string, source: string, resourceId = "ore", target = "consumer") => ({
  id,
  source,
  target,
  resourceKind: "item" as const,
  resourceId,
  targetHandle: `input:item:${resourceId}`,
});

describe("calculateSupplyShortfalls", () => {
  it("reports no deficit when the configured input is fully supplied", () => {
    const source = { ...consumer, id: "source", recipeId: "source" };
    const sourceRecipe = {
      ...consumerRecipe,
      id: "source",
      inputs: [],
      outputs: [{ kind: "item" as const, id: "ore", amount: 10 }],
    };
    const p = project({
      nodes: [source, consumer],
      recipes: [sourceRecipe, consumerRecipe],
      edges: [
        inputEdge("in", "source"),
        {
          id: "out",
          source: "consumer",
          target: "drain",
          resourceKind: "item",
          resourceId: "product",
        },
      ],
      storages: [{ id: "drain", kind: "item", resourceId: "product", position: { x: 200, y: 0 } }],
    });
    const computed = calculateThroughput(p, { generatedAt: "test" });
    expect(calculateSupplyShortfalls(p, computed).byNode.consumer).toBeUndefined();
  });

  it("reports a partial shortage in the solver's rate units", () => {
    const p = project({
      nodes: [consumer],
      recipes: [consumerRecipe],
      edges: [inputEdge("in", "source")],
    });
    const computed = result(
      { consumer: node("consumer", { "item:ore": flow("ore", 10) }) },
      {
        in: { transferredPerSecond: 6, nameplateDemandPerSecond: 10 },
      },
    );
    const shortfall = calculateSupplyShortfalls(p, computed).byNode.consumer?.[0];
    expect(shortfall).toMatchObject({
      requiredPerSecond: 10,
      suppliedPerSecond: 6,
      deficitPerSecond: 4,
    });
  });

  it("reports zero delivered when there is no incoming supply", () => {
    const p = project({
      nodes: [consumer],
      recipes: [consumerRecipe],
      edges: [inputEdge("in", "source")],
    });
    const computed = result({ consumer: node("consumer", { "item:ore": flow("ore", 10) }) });
    const shortfall = calculateSupplyShortfalls(p, computed).byNode.consumer?.[0];
    expect(shortfall).toMatchObject({
      requiredPerSecond: 10,
      suppliedPerSecond: 0,
      deficitPerSecond: 10,
    });
  });

  it("counts a shared upstream output only through each consumer's actual edge allocation", () => {
    const secondConsumer = { ...consumer, id: "consumer-2", recipeId: "consumer-2" };
    const secondRecipe = { ...consumerRecipe, id: "consumer-2" };
    const p = project({
      nodes: [consumer, secondConsumer],
      recipes: [consumerRecipe, secondRecipe],
      edges: [inputEdge("one", "source"), inputEdge("two", "source", "ore", "consumer-2")],
    });
    const computed = result(
      {
        consumer: node("consumer", { "item:ore": flow("ore", 10) }),
        "consumer-2": node("consumer-2", { "item:ore": flow("ore", 10) }),
      },
      {
        one: { transferredPerSecond: 4, nameplateDemandPerSecond: 10 },
        two: { transferredPerSecond: 4, nameplateDemandPerSecond: 10 },
      },
    );
    const report = calculateSupplyShortfalls(p, computed);
    expect(report.byNode.consumer?.[0]?.suppliedPerSecond).toBe(4);
    expect(report.byNode["consumer-2"]?.[0]?.suppliedPerSecond).toBe(4);
    expect(report.byEdge).toEqual({ one: 6, two: 6 });
  });

  it("uses settled upstream output rates so a shortage cascades to the next node", () => {
    const producer = { ...consumer, id: "producer", recipeId: "producer" };
    const middle = { ...consumer, id: "middle", recipeId: "middle" };
    const downstream = { ...consumer, id: "downstream", recipeId: "downstream" };
    const recipes = [
      {
        ...consumerRecipe,
        id: "producer",
        inputs: [{ kind: "item" as const, id: "raw", amount: 1 }],
        outputs: [{ kind: "item" as const, id: "ore", amount: 4 }],
      },
      {
        ...consumerRecipe,
        id: "middle",
        inputs: [{ kind: "item" as const, id: "ore", amount: 2 }],
        outputs: [{ kind: "item" as const, id: "plate", amount: 1 }],
      },
      {
        ...consumerRecipe,
        id: "downstream",
        inputs: [{ kind: "item" as const, id: "plate", amount: 2 }],
        outputs: [{ kind: "item" as const, id: "final", amount: 1 }],
      },
    ];
    const recipesWithTier = recipes.map((recipe) => ({ ...recipe, minimumTier: "LV" }));
    const p = project({
      nodes: [producer, middle, downstream],
      recipes: recipesWithTier,
      storages: [{ id: "drain", kind: "item", resourceId: "final", position: { x: 500, y: 0 } }],
      edges: [
        {
          id: "raw",
          source: "missing-source",
          target: "producer",
          resourceKind: "item" as const,
          resourceId: "raw",
          targetHandle: "input:item:raw",
        },
        {
          id: "ore",
          source: "producer",
          target: "middle",
          resourceKind: "item" as const,
          resourceId: "ore",
          targetHandle: "input:item:ore",
        },
        {
          id: "plate",
          source: "middle",
          target: "downstream",
          resourceKind: "item" as const,
          resourceId: "plate",
          targetHandle: "input:item:plate",
        },
      ],
    });
    const solved = calculateThroughput(p, { generatedAt: "test" });
    const report = calculateSupplyShortfalls(p, solved);
    expect(report.byNode.producer?.[0]?.resourceId).toBe("raw");
    expect(report.byNode.downstream?.[0]?.resourceId).toBe("plate");
    expect(report.byNode.downstream?.[0]?.suppliedPerSecond).toBeCloseTo(
      solved.edges.plate?.transferredPerSecond ?? 0,
    );
  });

  it("reuses the memoized report for equivalent position-only project updates", () => {
    const source = { ...consumer, id: "source", recipeId: "source" };
    const sourceRecipe = {
      ...consumerRecipe,
      id: "source",
      inputs: [],
      outputs: [{ kind: "item" as const, id: "ore", amount: 10 }],
    };
    const p = project({
      nodes: [source, consumer],
      recipes: [sourceRecipe, consumerRecipe],
      edges: [inputEdge("in", "source")],
    });
    const solved = calculateThroughput(p, { generatedAt: "test" });
    const first = getMemoizedSupplyShortfalls(p, solved);
    const moved = {
      ...p,
      nodes: p.nodes.map((entry) => ({ ...entry, position: { x: 20, y: 0 } })),
    };
    expect(getMemoizedSupplyShortfalls(moved, solved)).toBe(first);
  });

  it("invalidates the report when graph settings change without replacing recipes", () => {
    const p = project({ nodes: [consumer], recipes: [consumerRecipe] });
    const solved = calculateThroughput(p, { generatedAt: "test" });
    const first = getMemoizedSupplyShortfalls(p, solved);
    const disabled = {
      ...p,
      nodes: p.nodes.map((entry) => ({ ...entry, enabled: false })),
    };

    const changed = getMemoizedSupplyShortfalls(disabled, solved);
    expect(changed).not.toBe(first);
    expect(changed.byNode.consumer).toBeUndefined();
  });
});
