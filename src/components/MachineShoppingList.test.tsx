// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MachineShoppingList } from "./MachineShoppingList";
import { useFactoryStore } from "@/store/factory-store";
import { PROJECT_SCHEMA_VERSION, type FactoryProject } from "@/lib/model/types";
import { closeBoundaries } from "@/lib/solver/close-boundaries";

afterEach(cleanup);
function seed(solveMode = false, poolMode = false) {
  const p: FactoryProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "list-ui",
    name: "List UI",
    fuelProfiles: [],
    solveMode,
    poolMode,
    edges: [],
    recipes: [
      {
        id: "plate",
        name: "Copper Plate",
        machineType: "Bender",
        minimumTier: "LV",
        durationTicks: 20,
        eut: 8,
        inputs: [{ kind: "item", id: "copper", amount: 1 }],
        outputs: [{ kind: "item", id: "plate", displayName: "Copper Plate", amount: 1 }],
      },
    ],
    nodes: [0, 1].map((index) => ({
      id: `n${index}`,
      recipeId: "plate",
      machineCount: index + 2,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: index * 400, y: 0 },
      solvePin: index ? 6.25 : 0.125,
    })),
  };
  useFactoryStore.getState().setProject(closeBoundaries(p));
}

describe("MachineShoppingList", () => {
  it("renders one row per card and focuses/checks only that card", () => {
    seed();
    const { container } = render(<MachineShoppingList />);
    expect(container.querySelectorAll("[data-machine-node-id]")).toHaveLength(2);
    expect(screen.queryByText("Copper Plate")).toBeNull();
    const first = screen.getByRole("button", { name: "2× Bender" });
    const second = screen.getByRole("button", { name: "3× Bender" });
    fireEvent.click(first);
    expect(useFactoryStore.getState().boardFocusRequest?.nodeIds).toEqual(["n0"]);
    fireEvent.click(second);
    expect(useFactoryStore.getState().boardFocusRequest?.nodeIds).toEqual(["n1"]);
    act(() => useFactoryStore.getState().setChecklistMode(true));
    fireEvent.click(first);
    expect(useFactoryStore.getState().project.checklist?.cards).toEqual(["n0"]);
  });

  it.each([false, true])("shows fractional solved row counts and their total (pool=%s)", (pool) => {
    seed(true, pool);
    const { container } = render(<MachineShoppingList />);
    const first = screen.getByRole("button", { name: "0.125× Bender" });
    expect(within(first).getByText("0.125×")).toBeDefined();
    expect(screen.getByRole("button", { name: "6.25× Bender" })).toBeDefined();
    expect(container.querySelector(".inspector-count")?.textContent).toBe("6.375");
  });
});
