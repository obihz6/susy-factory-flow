import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject, type Recipe } from "../model/types";
import { getInputSupplyHatch } from "../model/hatch-supply";
import { normalizeLoadedProject } from "../model/project-normalize";
import { factoryProjectSchema } from "../model/schemas";
import { calculateThroughput } from "./throughput";
import { getPoolProject } from "./pool-mode";
import { expandHatchSupplies } from "./hatch-supply";
import { buildRailPorts, deriveNodeVerdict, findUnwiredNodeIds } from "@/components/flow/node-verdict";

function board(): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, id: "hatches", name: "Hatches",
    recipes: [{ id: "r", name: "Test", machineType: "Large Chemical Reactor", minimumTier: "LV",
      durationTicks: 20, eut: 30,
      inputs: [{ kind: "fluid", id: "water", amount: 12000, displayName: "Water" }],
      outputs: [{ kind: "item", id: "product", amount: 1 }],
    }],
    nodes: [{ id: "n", recipeId: "r", machineCount: 1, parallel: 1, overclockTier: "LV",
      enabled: true, position: { x: 0, y: 0 } }],
    storages: [{ id: "d", kind: "item", resourceId: "product", position: { x: 500, y: 0 }, targetPerSecond: 2 }],
    edges: [{ id: "out", source: "n", target: "d", resourceKind: "item", resourceId: "product" }],
    fuelProfiles: [],
  } as FactoryProject;
}

describe("hatch supply", () => {
  it("requires both toggles when a recipe consumes both water and air", () => {
    const project = board();
    project.recipes[0].inputs.push({ kind: "fluid", id: "air", amount: 8000 });
    project.nodes[0].hatchSupplies = ["water"];
    expect(calculateThroughput(project).nodes.n.utilization).toBe(0);
    const supplied: FactoryProject = { ...project, nodes: [{ ...project.nodes[0], hatchSupplies: ["water", "air"] }] };
    const result = calculateThroughput(supplied);
    expect(result.nodes.n.utilization).toBeCloseTo(1);
    expect(result.externalInputs).toEqual([]);
  });
  it.each(["water", "air"] as const)("fully supplies %s, keeps its rate, and removes its import", (id) => {
    const project = board();
    project.recipes[0].inputs[0].id = id;
    expect(calculateThroughput(project).nodes.n.utilization).toBe(0);
    project.nodes[0].hatchSupplies = [id];
    const result = calculateThroughput(project);
    expect(result.nodes.n.utilization).toBeCloseTo(1);
    expect(result.nodes.n.inputs[`fluid:${id}`].amountPerSecond).toBeGreaterThan(0);
    expect(result.externalInputs).toEqual([]);
    expect(result.resources[`fluid:${id}`].netPerSecond).toBeCloseTo(0);
    expect(findUnwiredNodeIds(project, result)).toEqual([]);
    const rails = buildRailPorts(project, result, "n", project.recipes[0], deriveNodeVerdict(project, result, "n"));
    expect(rails.inputs[0]).toMatchObject({ hatchSupplied: true, unsupplied: false });
    expect(rails.inputs[0].currentPerSecond).toBeGreaterThan(0);
    expect(project.storages).toHaveLength(1);
    expect(project.edges).toHaveLength(1);
  });

  it.each([false, true])("satisfies in solve mode, pool=%s, at the requested scale", (poolMode) => {
    const project = board();
    project.solveMode = true;
    project.poolMode = poolMode;
    project.nodes[0].hatchSupplies = ["water"];
    const result = calculateThroughput(project);
    expect(result.nodes.n.outputs["item:product"].amountPerSecond * result.nodes.n.utilization).toBeCloseTo(2);
    expect(result.externalInputs).toEqual([]);
    expect(getPoolProject(project).edges.some((edge) => edge.source.startsWith("hatch-supply:"))).toBe(true);
  });

  it("does not supply other machines or hide a missing ingredient", () => {
    const project = board();
    project.nodes[0].hatchSupplies = ["water"];
    project.recipes[0].inputs.push({ kind: "item", id: "ore", amount: 1 });
    expect(calculateThroughput(project).nodes.n.utilization).toBe(0);
    project.recipes[0].inputs.pop();
    project.nodes.push({ ...project.nodes[0], id: "other", hatchSupplies: undefined });
    project.edges.push({ ...project.edges[0], id: "other-out", source: "other" });
    const result = calculateThroughput(project);
    expect(result.nodes.n.utilization).toBeCloseTo(1);
    expect(result.nodes.other.utilization).toBe(0);
  });

  it("does not accept cells, distilled water, liquid air, singles, or unverified multis", () => {
    const project = board(), recipe = project.recipes[0], node = project.nodes[0];
    for (const resource of [{ kind: "item", id: "water" }, { kind: "fluid", id: "ic2distilledwater" }, { kind: "fluid", id: "liquidair" }] as const) {
      expect(getInputSupplyHatch(recipe, node, resource)).toBeUndefined();
    }
    for (const machineType of ["Chemical Reactor", "Chemical Plant", "Steam Separator", "Unknown Multiblock"]) {
      const changed = { ...recipe, machineType };
      expect(getInputSupplyHatch(changed, node, recipe.inputs[0])).toBeUndefined();
    }
    node.hatchSupplies = ["water"];
    recipe.machineHandlers = [
      { id: "multi", machineType: "Large Chemical Reactor", label: "Large Chemical Reactor", kind: "multiblock", minimumTier: "LV" },
      { id: "single", machineType: "Chemical Reactor", label: "Chemical Reactor", kind: "single", minimumTier: "LV" },
    ];
    node.machineHandlerId = "single";
    expect(calculateThroughput(project).nodes.n.utilization).toBe(0);
  });

  it("saves, reloads, shares the hatch between sections, and expands only once", () => {
    const project = board();
    project.nodes[0].hatchSupplies = ["water"];
    project.nodes[0].extraRecipes = [{ recipeId: "r2" }];
    project.recipes.push({ ...project.recipes[0], id: "r2" } as Recipe);
    project.edges.push({ ...project.edges[0], id: "out2", sourceHandle: "r1:output:item:product" });
    const loaded = normalizeLoadedProject(factoryProjectSchema.parse(JSON.parse(JSON.stringify(project))));
    expect(loaded.nodes[0].hatchSupplies).toEqual(["water"]);
    const expanded = getPoolProject(loaded);
    expect(expanded.edges.filter((edge) => edge.source.startsWith("hatch-supply:"))).toHaveLength(2);
    expect(expandHatchSupplies(expanded)).toBe(expanded);
    expect(getPoolProject(expanded)).toBe(expanded);
    expect(calculateThroughput(expanded).externalInputs).toEqual([]);
    const result = calculateThroughput(loaded);
    expect(result.nodes.n.utilization + result.nodes["n#r1"].utilization).toBeCloseTo(1);
    expect(result.externalInputs).toEqual([]);
  });

  it("can re-read and re-solve a shared machine in pool mode without duplicating sources", () => {
    const project = board();
    project.poolMode = true;
    project.solveMode = true;
    project.nodes[0].hatchSupplies = ["water"];
    project.nodes[0].extraRecipes = [{ recipeId: "r2" }];
    project.recipes.push({ ...project.recipes[0], id: "r2" });
    const expanded = getPoolProject(project);
    expect(getPoolProject(expanded)).toBe(expanded);
    const result = calculateThroughput(expanded);
    expect(result.externalInputs).toEqual([]);
    expect(Object.keys(result.nodes)).toEqual(["n", "n#r1"]);
  });

  it("preserves saved wires, restores them when disabled, and bypasses cross-form wires", () => {
    const project = board();
    project.nodes[0].hatchSupplies = ["water"];
    const wire = { id: "water-wire", source: "s", target: "n", resourceKind: "item" as const, resourceId: "water-cell", targetHandle: "input:fluid:water", crossForm: { litresPerCell: 1000 } };
    project.edges.push(wire);
    expect(expandHatchSupplies(project).edges.some((edge) => edge.id === wire.id)).toBe(false);
    expect(project.edges).toContain(wire);
    const off = { ...project, nodes: [{ ...project.nodes[0], hatchSupplies: undefined }] };
    expect(expandHatchSupplies(off).edges).toContain(wire);
  });
});
