import { describe, expect, it } from "vitest";
import { useFactoryStore } from "@/store/factory-store";
import { buildPowerRecipe, resynthesizePowerRecipes } from "./power-recipe";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";

/**
 * Switching a power card's fuel with wires attached: a source drawer that
 * serves ONLY this card follows the fuel (same wire, new resource); a drawer
 * with other duties keeps them and just loses this wire; a machine at the
 * far end always loses the wire - its output is what it is.
 */
const TURBINE_SETTINGS = {
  rotor: "Carbon",
  size: "Normal",
  fitting: "tight",
  flowMode: "optimal",
  fuel: "Benzene",
};

function turbineProject(extra: Partial<FactoryProject>): FactoryProject {
  const recipe = buildPowerRecipe("large-gas-turbine", TURBINE_SETTINGS, "r-gt")!;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "p",
    name: "p",
    recipes: [recipe],
    nodes: [
      {
        id: "n-gt",
        recipeId: "r-gt",
        machineCount: 1,
        parallel: 1,
        overclockTier: "LV",
        enabled: true,
        position: { x: 0, y: 0 },
        machineConfigTiers: TURBINE_SETTINGS,
      },
    ],
    storages: [
      { id: "s", kind: "fluid", resourceId: "benzene", displayName: "Benzene", position: { x: 0, y: 0 } },
    ],
    edges: [
      {
        id: "e",
        source: "s",
        target: "n-gt",
        sourceHandle: "output:fluid:benzene",
        targetHandle: "input:fluid:benzene",
        resourceKind: "fluid",
        resourceId: "benzene",
      },
    ],
    fuelProfiles: [],
    setupRules: { freeInputs: true, freeOutputs: true },
    ...extra,
  } as unknown as FactoryProject;
}

describe("fuel switches with wires attached", () => {
  it("retargets a lone source drawer to the new fuel, wire intact", () => {
    useFactoryStore.getState().setProject(turbineProject({}));
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    expect(after.storages?.[0]).toMatchObject({ resourceId: "nitrobenzene", kind: "fluid" });
    expect(after.edges[0]).toMatchObject({
      resourceId: "nitrobenzene",
      sourceHandle: "output:fluid:nitrobenzene",
      targetHandle: "input:fluid:nitrobenzene",
    });
  });

  it("only drops the wire when the drawer serves anything else", () => {
    const base = turbineProject({});
    const recipe2 = buildPowerRecipe("large-gas-turbine", TURBINE_SETTINGS, "r-gt2")!;
    useFactoryStore.getState().setProject({
      ...base,
      recipes: [...base.recipes, recipe2],
      nodes: [
        ...base.nodes,
        {
          id: "n-other",
          recipeId: "r-gt2",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 200 },
          machineConfigTiers: TURBINE_SETTINGS,
        },
      ],
      edges: [
        ...base.edges,
        {
          id: "e2",
          source: "s",
          target: "n-other",
          resourceKind: "fluid",
          resourceId: "benzene",
        },
      ],
    } as FactoryProject);
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    // The drawer still owes benzene to the other card, so it stays benzene;
    // the switched card's wire is gone, the other card's survives.
    expect(after.storages?.[0]?.resourceId).toBe("benzene");
    expect(after.edges.map((edge) => edge.id).sort()).toEqual(["e2"]);
  });

  it("survives the real wire gesture: connect, unwire, switch fuel", () => {
    // The gesture path (addStorageForConnection -> applyEdgeInputOverride)
    // used to stamp a benzene input override on the node. The override
    // OUTLIVED the wire, so after unwiring, every fuel switch rebuilt the
    // recipe correctly and the override painted benzene back over it.
    const project = turbineProject({ storages: [], edges: [] });
    useFactoryStore.getState().setProject(project);
    useFactoryStore
      .getState()
      .addStorageForConnection(
        { kind: "fluid", id: "benzene", displayName: "Benzene" },
        "n-gt",
        "input",
        { x: 0, y: 200 },
        "input:fluid:benzene",
      );
    const wired = useFactoryStore.getState().project;
    expect(wired.edges).toHaveLength(1);
    expect(wired.nodes[0].recipeInputOverrides).toBeUndefined();

    useFactoryStore.getState().deleteEdge(wired.edges[0].id);
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    expect(after.recipes.find((entry) => entry.id === "r-gt")?.inputs[0]?.id).toBe("nitrobenzene");
  });

  it("heals a node already stuck with a stamped override", () => {
    const base = turbineProject({ storages: [], edges: [] });
    useFactoryStore.getState().setProject({
      ...base,
      nodes: [
        {
          ...base.nodes[0],
          recipeInputOverrides: {
            "0": { kind: "fluid", id: "benzene", amount: 1, displayName: "Benzene" },
          },
        },
      ],
    } as FactoryProject);
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    expect(after.nodes[0].recipeInputOverrides).toBeUndefined();
    expect(after.recipes.find((entry) => entry.id === "r-gt")?.inputs[0]?.id).toBe("nitrobenzene");
  });

  it("refactors a power card onto another generator in place, wire intact", () => {
    useFactoryStore.getState().setProject(turbineProject({}));
    useFactoryStore.getState().refactorNodeToPowerSource("n-gt", "large-gas-turbine", undefined);
    const after = useFactoryStore.getState().project;
    // Same node, new owned recipe; the benzene wire re-docks; the old owned
    // power recipe does not linger.
    const node = after.nodes.find((entry) => entry.id === "n-gt")!;
    const recipe = after.recipes.find((entry) => entry.id === node.recipeId)!;
    expect(recipe.power?.sourceId).toBe("large-gas-turbine");
    expect(after.nodes).toHaveLength(1);
    expect(after.edges).toHaveLength(1);
    expect(after.edges[0].target).toBe("n-gt");
    expect(after.edges[0].resourceId).toBe("benzene");
    expect(after.recipes.some((entry) => entry.id === "r-gt")).toBe(false);
  });

  it("gives a cloned power card its own recipe, and knobs stay per card", () => {
    useFactoryStore.getState().setProject(turbineProject({ storages: [], edges: [] }));
    useFactoryStore.getState().duplicateNode("n-gt");
    const cloned = useFactoryStore.getState().project;
    expect(cloned.nodes).toHaveLength(2);
    const [original, clone] = cloned.nodes;
    expect(clone.recipeId).not.toBe(original.recipeId);
    // Turning the clone's fuel knob leaves the original's recipe alone.
    useFactoryStore.getState().setPowerSetting(clone.id, "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    const originalRecipe = after.recipes.find(
      (entry) => entry.id === after.nodes[0].recipeId,
    )!;
    const cloneRecipe = after.recipes.find((entry) => entry.id === after.nodes[1].recipeId)!;
    expect(originalRecipe.inputs[0]?.id).toBe("benzene");
    expect(cloneRecipe.inputs[0]?.id).toBe("nitrobenzene");
  });

  it("heals two nodes sharing one power recipe: on write and on load", () => {
    // The conjoined state older clones left behind: two nodes, one recipe.
    const base = turbineProject({ storages: [], edges: [] });
    const conjoined = {
      ...base,
      nodes: [
        ...base.nodes,
        { ...base.nodes[0], id: "n-gt2", machineConfigTiers: { ...TURBINE_SETTINGS } },
      ],
    } as FactoryProject;

    // On write: the edited node takes its own copy; the other keeps its recipe.
    useFactoryStore.getState().setProject(conjoined);
    useFactoryStore.getState().setPowerSetting("n-gt2", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    const first = after.nodes.find((entry) => entry.id === "n-gt")!;
    const second = after.nodes.find((entry) => entry.id === "n-gt2")!;
    expect(second.recipeId).not.toBe(first.recipeId);
    expect(after.recipes.find((entry) => entry.id === first.recipeId)?.inputs[0]?.id).toBe(
      "benzene",
    );
    expect(after.recipes.find((entry) => entry.id === second.recipeId)?.inputs[0]?.id).toBe(
      "nitrobenzene",
    );

    // On load: the funnel splits them and rebuilds each from its own settings.
    const healed = resynthesizePowerRecipes({
      ...conjoined,
      nodes: conjoined.nodes.map((node) =>
        node.id === "n-gt2"
          ? { ...node, machineConfigTiers: { ...TURBINE_SETTINGS, fuel: "Nitrobenzene" } }
          : node,
      ),
    });
    const healedFirst = healed.nodes.find((entry) => entry.id === "n-gt")!;
    const healedSecond = healed.nodes.find((entry) => entry.id === "n-gt2")!;
    expect(healedSecond.recipeId).not.toBe(healedFirst.recipeId);
    expect(
      healed.recipes.find((entry) => entry.id === healedSecond.recipeId)?.inputs[0]?.id,
    ).toBe("nitrobenzene");
    expect(
      healed.recipes.find((entry) => entry.id === healedFirst.recipeId)?.inputs[0]?.id,
    ).toBe("benzene");
  });

  it("drops the wire when the far end is a machine", () => {
    const base = turbineProject({});
    const maker = {
      id: "r-maker",
      name: "maker",
      machineType: "Distillery",
      minimumTier: "LV",
      durationTicks: 20,
      eut: 24,
      inputs: [],
      outputs: [{ kind: "fluid" as const, id: "benzene", amount: 40 }],
    };
    useFactoryStore.getState().setProject({
      ...base,
      recipes: [...base.recipes, maker],
      nodes: [
        ...base.nodes,
        {
          id: "n-maker",
          recipeId: "r-maker",
          machineCount: 1,
          parallel: 1,
          overclockTier: "LV",
          enabled: true,
          position: { x: 0, y: 200 },
        },
      ],
      storages: [],
      edges: [
        {
          id: "e-machine",
          source: "n-maker",
          target: "n-gt",
          resourceKind: "fluid",
          resourceId: "benzene",
        },
      ],
    } as FactoryProject);
    useFactoryStore.getState().setPowerSetting("n-gt", "fuel", "Nitrobenzene");
    const after = useFactoryStore.getState().project;
    expect(after.edges).toHaveLength(0);
    expect(after.recipes.find((entry) => entry.id === "r-gt")?.inputs[0]?.id).toBe("nitrobenzene");
  });
});
