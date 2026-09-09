import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { buildPortFlowScope, buildStorageFlowScope } from "./flow-scope";
import { makeResourceHandleId, sectionHandleId } from "./resource-handles";

const out = (id: string, section = 0) =>
  sectionHandleId(section, makeResourceHandleId("output", { kind: "item", id }));
const into = (id: string, section = 0) =>
  sectionHandleId(section, makeResourceHandleId("input", { kind: "item", id }));

function project(patch: Partial<FactoryProject>): FactoryProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "p",
    name: "p",
    nodes: [],
    recipes: [],
    edges: [],
    storages: [],
    ...patch,
  } as FactoryProject;
}

const wire = (
  id: string,
  source: string,
  target: string,
  resourceId: string,
  handles?: { sourceHandle?: string; targetHandle?: string },
) => ({
  id,
  source,
  target,
  resourceKind: "item" as const,
  resourceId,
  sourceHandle: handles?.sourceHandle,
  targetHandle: handles?.targetHandle,
});

const port = (side: "input" | "output", resourceId: string, section = 0) => ({
  side,
  kind: "item" as const,
  resourceId,
  handleId: side === "output" ? out(resourceId, section) : into(resourceId, section),
});

describe("buildPortFlowScope", () => {
  it("lights only the section the port belongs to on a shared machine", () => {
    // One card, two recipes, both making dust: section 0 ships to A and
    // section 1 to B. Pointing at one must not light the other's wire.
    const plan = project({
      edges: [
        wire("w0", "shared", "a", "dust", { sourceHandle: out("dust", 0), targetHandle: into("dust") }),
        wire("w1", "shared", "b", "dust", { sourceHandle: out("dust", 1), targetHandle: into("dust") }),
      ],
    });
    const first = buildPortFlowScope(plan, "shared", port("output", "dust", 0));
    expect(Object.keys(first.edges)).toEqual(["w0"]);
    expect(first.nodes).toHaveProperty("a");
    expect(first.nodes).not.toHaveProperty("b");

    const second = buildPortFlowScope(plan, "shared", port("output", "dust", 1));
    expect(Object.keys(second.edges)).toEqual(["w1"]);
    expect(second.nodes).toHaveProperty("b");
    expect(second.nodes).not.toHaveProperty("a");
  });

  it("carries on through a drawer to everything it feeds", () => {
    // maker -> drawer -> two machines, and one of those through a second
    // drawer: a buffer is a junction, so the whole run lights.
    const plan = project({
      storages: [
        { id: "d1", kind: "item", resourceId: "dust", position: { x: 0, y: 0 } },
        { id: "d2", kind: "item", resourceId: "dust", position: { x: 0, y: 0 } },
      ],
      edges: [
        wire("w1", "maker", "d1", "dust", { sourceHandle: out("dust") }),
        wire("w2", "d1", "eater", "dust", { targetHandle: into("dust") }),
        wire("w3", "d1", "d2", "dust"),
        wire("w4", "d2", "far", "dust", { targetHandle: into("dust") }),
        // Another maker filling the same drawer is UPSTREAM: pointing at an
        // output asks where this goes, not who else fills it.
        wire("w5", "other", "d1", "dust", { sourceHandle: out("dust") }),
      ],
    });
    const scope = buildPortFlowScope(plan, "maker", port("output", "dust"));
    expect(Object.keys(scope.edges).sort()).toEqual(["w1", "w2", "w3", "w4"]);
    expect(Object.keys(scope.nodes).sort()).toEqual(["d1", "d2", "eater", "far", "maker"]);
  });

  it("walks upstream from an input, through the drawers that fill it", () => {
    const plan = project({
      storages: [{ id: "d1", kind: "item", resourceId: "dust", position: { x: 0, y: 0 } }],
      edges: [
        wire("w1", "maker", "d1", "dust", { sourceHandle: out("dust") }),
        wire("w2", "d1", "eater", "dust", { targetHandle: into("dust") }),
        // The drawer's other taker is not on the way IN to this machine.
        wire("w3", "d1", "sibling", "dust", { targetHandle: into("dust") }),
      ],
    });
    const scope = buildPortFlowScope(plan, "eater", port("input", "dust"));
    expect(Object.keys(scope.edges).sort()).toEqual(["w1", "w2"]);
    expect(scope.nodes).toHaveProperty("maker");
    expect(scope.nodes).not.toHaveProperty("sibling");
  });
});

describe("buildStorageFlowScope", () => {
  it("lights both sides of the drawer and on through the next one", () => {
    const plan = project({
      storages: [
        { id: "d1", kind: "item", resourceId: "dust", position: { x: 0, y: 0 } },
        { id: "d2", kind: "item", resourceId: "dust", position: { x: 0, y: 0 } },
      ],
      edges: [
        wire("w1", "maker", "d1", "dust", { sourceHandle: out("dust") }),
        wire("w2", "d1", "d2", "dust"),
        wire("w3", "d2", "eater", "dust", { targetHandle: into("dust") }),
        wire("w4", "elsewhere", "other", "dust", { sourceHandle: out("dust") }),
      ],
    });
    const scope = buildStorageFlowScope(plan, { id: "d1", kind: "item", resourceId: "dust" });
    expect(Object.keys(scope.edges).sort()).toEqual(["w1", "w2", "w3"]);
    expect(Object.keys(scope.nodes).sort()).toEqual(["d1", "d2", "eater", "maker"]);
  });
});
