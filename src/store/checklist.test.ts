import { beforeEach, describe, expect, it } from "vitest";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { useFactoryStore } from "./factory-store";

const plan: FactoryProject = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: "checklist-test",
  name: "Checklist",
  fuelProfiles: [],
  recipes: [
    {
      id: "recipe",
      name: "Dust",
      machineType: "Macerator",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 0,
      inputs: [],
      outputs: [{ kind: "item", id: "dust", amount: 1 }],
    },
  ],
  nodes: ["a", "b"].map((id) => ({
    id,
    recipeId: "recipe",
    enabled: true,
    machineCount: 1,
    parallel: 1,
    overclockTier: "LV",
    position: { x: 0, y: 0 },
  })),
  storages: [{ id: "drawer", kind: "item", resourceId: "dust", position: { x: 600, y: 0 } }],
  edges: [{ id: "wire", source: "a", target: "drawer", resourceKind: "item", resourceId: "dust" }],
};

describe("construction checklist", () => {
  beforeEach(() => {
    useFactoryStore.getState().setProject(plan);
    useFactoryStore.getState().setChecklistMode(false);
  });
  it("checks cards, drawers and wires independently without recalculation or editing them", () => {
    const before = useFactoryStore.getState();
    before.toggleChecklist("cards", ["a", "drawer"]);
    before.toggleChecklist("edges", ["wire"]);
    const after = useFactoryStore.getState();
    expect(after.project.checklist).toEqual({ cards: ["a", "drawer"], edges: ["wire"] });
    expect(after.lastResult).toBe(before.lastResult);
    expect(after.project.nodes).toBe(before.project.nodes);
    expect(after.project.edges).toBe(before.project.edges);
    after.toggleChecklist("cards", ["a"]);
    expect(useFactoryStore.getState().project.checklist?.cards).toEqual(["drawer"]);
  });
  it("finishes a partially checked machine group, then restores the whole group", () => {
    const store = useFactoryStore.getState();
    store.toggleChecklist("cards", ["a"]);
    store.toggleChecklist("cards", ["a", "b", "missing"]);
    expect(useFactoryStore.getState().project.checklist?.cards).toEqual(["a", "b"]);
    store.toggleChecklist("cards", ["a", "b"]);
    expect(useFactoryStore.getState().project.checklist?.cards).toEqual([]);
  });
  it("survives serialization, mode changes and undoable reset", () => {
    const store = useFactoryStore.getState();
    store.toggleChecklist("cards", ["a"]);
    const saved = factoryProjectSchema.parse(
      JSON.parse(JSON.stringify(useFactoryStore.getState().project)),
    );
    store.setProject(saved);
    store.setChecklistMode(true);
    store.setChecklistMode(false);
    expect(useFactoryStore.getState().project.checklist?.cards).toEqual(["a"]);
    store.clearChecklist();
    expect(useFactoryStore.getState().project.checklist).toBeUndefined();
    store.undo();
    expect(useFactoryStore.getState().project.checklist?.cards).toEqual(["a"]);
    store.redo();
    expect(useFactoryStore.getState().project.checklist).toBeUndefined();
  });
  it("keeps progress separate between designs and accepts old plans", () => {
    const store = useFactoryStore.getState();
    store.toggleChecklist("cards", ["a"]);
    const checked = useFactoryStore.getState().project;
    store.setProject({ ...plan, id: "another" });
    expect(useFactoryStore.getState().project.checklist).toBeUndefined();
    store.setProject(checked);
    expect(useFactoryStore.getState().project.checklist?.cards).toEqual(["a"]);
  });
});
