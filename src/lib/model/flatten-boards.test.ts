import { describe, expect, it } from "vitest";
import { flattenBoards } from "./flatten-boards";
import type { FactoryProject } from "./types";

// The least project the dump needs: cards, one nested board pair, one
// legacy pocket that never stood open.
const project = {
  id: "p",
  name: "p",
  nodes: [
    { id: "root", position: { x: 100, y: 100 } },
    { id: "inner", pocketId: "outer", position: { x: 40, y: 60 } },
    { id: "deep", pocketId: "nested", position: { x: 20, y: 20 } },
    { id: "legacy", pocketId: "old", position: { x: 500, y: 500 } },
  ],
  storages: [{ id: "drawer", pocketId: "outer", position: { x: 0, y: 200 } }],
  annotations: [{ id: "note", pocketId: "nested", position: { x: 5, y: 5 } }],
  pockets: [
    { id: "outer", name: "Outer", position: { x: 1000, y: 2000 }, size: { width: 800, height: 600 }, expanded: true },
    {
      id: "nested",
      name: "Nested",
      parentPocketId: "outer",
      position: { x: 300, y: 100 },
      size: { width: 200, height: 200 },
      expanded: true,
    },
    { id: "old", name: "Old", position: { x: 0, y: 0 } },
  ],
  edges: [],
  recipes: [],
} as unknown as FactoryProject;

describe("flattenBoards", () => {
  it("surfaces every member where its frame stood and drops the boards", () => {
    const flat = flattenBoards(project);
    const at = (id: string) => {
      const item = [...flat.nodes, ...(flat.storages ?? []), ...(flat.annotations ?? [])].find(
        (entry) => entry.id === id,
      )!;
      return { ...item.position, pocketId: item.pocketId };
    };
    expect(flat.pockets).toEqual([]);
    expect(at("root")).toEqual({ x: 100, y: 100, pocketId: undefined });
    // One fitted frame: its corner is added back.
    expect(at("inner")).toEqual({ x: 1040, y: 2060, pocketId: undefined });
    expect(at("drawer")).toEqual({ x: 1000, y: 2200, pocketId: undefined });
    // Nested: both frames' corners.
    expect(at("deep")).toEqual({ x: 1320, y: 2120, pocketId: undefined });
    expect(at("note")).toEqual({ x: 1305, y: 2105, pocketId: undefined });
    // A legacy pocket never stood open: members keep their own coordinates.
    expect(at("legacy")).toEqual({ x: 500, y: 500, pocketId: undefined });
  });

  it("returns the same project when there are no boards", () => {
    const bare = { ...project, pockets: [] } as FactoryProject;
    expect(flattenBoards(bare)).toBe(bare);
  });
});
