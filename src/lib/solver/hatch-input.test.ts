import { applyMachineHandlerToRecipe } from "@/lib/model/recipe-rules";
import { calculateThroughput } from "./throughput";
import { describe, expect, it } from "vitest";
import type { FactoryNode, Recipe } from "@/lib/model/types";
import { createEmptyProject } from "@/examples/empty-project";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { getNodePowerReport } from "./power-report";
import { getOverclockedRecipeStats } from "./overclock";
import { getMachineStructuralParallels } from "./machine-effects";
import {
  normalizeHatchInput,
  hatchEquivalent,
  roundHatchBudget,
  stepWholeAmp,
  stepPowerOfFourAmps,
} from "./hatch-input";
import { listPowerWinsCached } from "./power-wins";
import { useFactoryStore } from "@/store/factory-store";

const recipe = (machineType = "Large Chemical Reactor", eut = 480): Recipe => ({
  id: machineType,
  name: machineType,
  machineType,
  minimumTier: "HV",
  durationTicks: 400,
  eut,
  inputs: [],
  outputs: [],
  machineHandlers: [
    { id: machineType, label: machineType, machineType, minimumTier: "LV", kind: "multiblock" },
  ],
});
const node = (patch: Partial<FactoryNode> = {}): FactoryNode => ({
  id: "a",
  recipeId: "Large Chemical Reactor",
  overclockTier: "HV",
  machineCount: 1,
  parallel: 1,
  enabled: true,
  position: { x: 0, y: 0 },
  ...patch,
});

describe("per-card hatch input", () => {
  it("distinguishes equal supplies by hatch voltage and applies zero tier skips", () => {
    const r = recipe("Precise Assembler", 524288);
    const low = getNodePowerReport(r, node({ hatchVoltageTier: "ZPM", hatchAmps: 4096 }));
    const high = getNodePowerReport(r, node({ hatchVoltageTier: "UHV", hatchAmps: 256 }));
    expect(low.poolEuT).toBe(high.poolEuT);
    expect(low.state).toBe("over-tier");
    expect(high.state).toBe("ok");
    expect(
      getNodePowerReport(
        recipe("Industrial Arc Furnace", 120),
        node({ hatchVoltageTier: "LV", hatchAmps: 100 }),
      ).state,
    ).toBe("over-tier");
  });
  it("pins a fully wired over-tier build to zero and resumes it at a legal voltage", () => {
    const r = recipe("Precise Assembler", 524288);
    r.inputs = [{ kind: "item", id: "ore", amount: 1 }];
    r.outputs = [{ kind: "item", id: "dust", amount: 1 }];
    const p = {
      ...createEmptyProject(),
      recipes: [r],
      nodes: [node({ recipeId: r.id, hatchVoltageTier: "ZPM", hatchAmps: 4096 })],
      storages: [
        { id: "in", kind: "item" as const, resourceId: "ore", position: { x: -200, y: 0 } },
        { id: "out", kind: "item" as const, resourceId: "dust", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "feed", source: "in", target: "a", resourceKind: "item" as const, resourceId: "ore" },
        {
          id: "ship",
          source: "a",
          target: "out",
          resourceKind: "item" as const,
          resourceId: "dust",
        },
      ],
    };
    const stalled = calculateThroughput(p);
    expect(stalled.nodes.a.powerStalled).toBe(true);
    expect(stalled.nodes.a.utilization).toBe(0);
    expect(stalled.edges.ship.transferredPerSecond).toBe(0);
    const raw = calculateThroughput({
      ...p,
      nodes: p.nodes.map((n) => ({ ...n, powerInputMode: "eut" as const })),
    });
    expect(raw.nodes.a.powerStalled).not.toBe(true);
    expect(raw.edges.ship.transferredPerSecond).toBeGreaterThan(0);
    const running = calculateThroughput({
      ...p,
      nodes: [{ ...p.nodes[0], hatchVoltageTier: "UHV", hatchAmps: 256 }],
    });
    expect(running.nodes.a.powerStalled).toBe(false);
    expect(running.nodes.a.utilization).toBeGreaterThan(0.99);
    expect(running.edges.ship.transferredPerSecond).toBeGreaterThan(0);
  });
  it("caps amperage-off overclocks at hatch voltage while amps still feed parallels", () => {
    const r = recipe("Nano Forge", 120);
    r.minimumTier = "MV";
    r.machineConfigControls = [
      {
        id: "parallel",
        label: "Parallel",
        defaultKey: "p",
        minimumKey: "p",
        tiers: [
          {
            key: "p",
            label: "4",
            resource: { kind: "item", id: "parallel", amount: 1 },
            parallelMultiplier: 4,
          },
        ],
      },
    ];
    const one = getNodePowerReport(r, node({ hatchVoltageTier: "MV", hatchAmps: 1 }));
    const many = getNodePowerReport(r, node({ hatchVoltageTier: "MV", hatchAmps: 100 }));
    expect(one.parallels).toBe(1);
    expect(many.parallels).toBe(4);
    expect(many.overclockSteps).toBe(0);
    expect(
      getOverclockedRecipeStats(r, node({ hatchVoltageTier: "HV", hatchAmps: 100 })).overclockSteps,
    ).toBe(1);
  });
  it("seeds full structural parallels without overclocks, including voltage-scaled machines", () => {
    for (const machine of [
      "Large Chemical Reactor",
      "Industrial Chemical Bath",
      "Volcanus",
      "Neutron Activator",
    ]) {
      const r = recipe(machine, 480);
      const n = normalizeHatchInput(r, node({ recipeId: r.id }));
      const report = getNodePowerReport(r, n);
      expect(n.hatchVoltageTier).toBe("HV");
      expect(report.state).toBe("ok");
      expect(report.parallels).toBe(
        getMachineStructuralParallels(applyMachineHandlerToRecipe(r, n), n),
      );
      expect(report.overclockSteps).toBe(0);
      expect(normalizeHatchInput(r, n)).toBe(n);
    }
  });
  it("preserves legacy total exactly, serializes the pair, and is idempotent", () => {
    const r = recipe();
    const p = { ...createEmptyProject(), recipes: [r], nodes: [node({ powerEuT: 6000 })] };
    const migrated = normalizeLoadedProject(p);
    expect(migrated.nodes[0]).toMatchObject({
      hatchVoltageTier: "EV",
      hatchAmps: 6000 / 2048,
      powerEuT: 6000,
    });
    const parsed = factoryProjectSchema.parse(JSON.parse(JSON.stringify(migrated)));
    expect(normalizeLoadedProject(parsed).nodes[0]).toEqual(migrated.nodes[0]);
    expect(normalizeLoadedProject(migrated)).toEqual(migrated);
  });
  it.each([1, 2])(
    "preserves legacy voltage and performance with %i energy hatches",
    (energyHatches) => {
      const r = recipe("Nano Forge", 120);
      r.minimumTier = "MV";
      const old = node({ recipeId: r.id, overclockTier: "HV", energyHatches });
      const before = getNodePowerReport(r, old);
      const migrated = normalizeLoadedProject({
        ...createEmptyProject(),
        recipes: [r],
        nodes: [old],
      }).nodes[0];
      expect(migrated).toMatchObject({
        hatchVoltageTier: "HV",
        hatchAmps: energyHatches === 1 ? 1 : 4,
      });
      const after = getNodePowerReport(r, migrated);
      expect(before.overclockSteps).toBeGreaterThan(0);
      expect(after.overclockSteps).toBe(before.overclockSteps);
      expect(after.poolEuT).toBe(before.poolEuT);
      expect(after.parallels).toBe(before.parallels);
      expect(getOverclockedRecipeStats(r, migrated).durationTicks).toBe(
        getOverclockedRecipeStats(r, old).durationTicks,
      );
    },
  );
  it("derives power from the pair even when a persisted total disagrees", () => {
    const n = normalizeHatchInput(
      recipe(),
      node({ hatchVoltageTier: "IV", hatchAmps: 4, powerEuT: 1 }),
    );
    expect(n.powerEuT).toBe(32768);
    expect(getNodePowerReport(recipe(), n).poolEuT).toBe(32768);
  });
  it("keeps card supplies independent through edits, undo, and reload", () => {
    const store = useFactoryStore;
    store.getState().setProject({
      ...createEmptyProject(),
      recipes: [recipe()],
      nodes: [
        node({ hatchVoltageTier: "HV", hatchAmps: 1 }),
        node({ id: "b", hatchVoltageTier: "IV", hatchAmps: 4 }),
      ],
    });
    store.getState().updateNode("a", { hatchVoltageTier: "EV", hatchAmps: 2.5 });
    expect(store.getState().project.nodes.map((n) => n.powerEuT)).toEqual([5120, 32768]);
    store.getState().undo();
    expect(store.getState().project.nodes[0].hatchVoltageTier).toBe("HV");
    const loaded = normalizeLoadedProject(store.getState().project);
    expect(loaded.nodes[1].hatchAmps).toBe(4);
  });
  it("keys the breakpoint ladder by voltage, not the current amps", () => {
    const r = recipe("Nano Forge", 120);
    r.minimumTier = "MV";
    const a = node({ hatchVoltageTier: "MV", hatchAmps: 4 });
    const low = listPowerWinsCached(r, a);
    expect(listPowerWinsCached(r, { ...a, hatchAmps: 100 })).toBe(low);
    const high = listPowerWinsCached(r, { ...a, hatchVoltageTier: "HV" });
    expect(high.some((w) => w.overclockSteps > 0)).toBe(true);
    expect(low.every((w) => w.overclockSteps === 0)).toBe(true);
  });
  it("names the lone-hatch clamp and rounds EU/t entry without rounding typed amps", () => {
    expect(hatchEquivalent(1, "IV")).toContain("only counts as 1A");
    expect(hatchEquivalent(4, "IV")).toBe("= 2 IV hatches");
    expect(hatchEquivalent(2, "IV")).toBeUndefined();
    expect(roundHatchBudget(32000, 8192)).toBe(4);
    expect(roundHatchBudget(9000, 8192)).toBe(1);
  });
});

describe("raw EU/t and whole amp steps", () => {
  it("steps fractional amps onto adjacent integers without losing typed precision", () => {
    expect(stepWholeAmp(3.75, 1)).toBe(4);
    expect(stepWholeAmp(3.75, -1)).toBe(3);
    expect(stepWholeAmp(4, 1)).toBe(5);
    expect(stepWholeAmp(4, -1)).toBe(3);
    expect(stepWholeAmp(0.2, -1)).toBe(0);
    expect(stepWholeAmp(0, -1)).toBe(0);
    expect(stepWholeAmp(4, 1, 10)).toBe(14);
    expect(stepWholeAmp(104, -1, 100)).toBe(4);
    expect(stepWholeAmp(4, 1, 1000)).toBe(1004);
    expect(stepWholeAmp(3.75, 1, 100)).toBe(103);
    expect(stepWholeAmp(103.75, -1, 100)).toBe(4);
    expect(stepWholeAmp(3.75, -1, 1000)).toBe(0);
  });
  it("snaps amps directionally through powers of four up to the selectable amperage ceiling", () => {
    for (const [amps, down, up] of [
      [0, 0, 1], [0.5, 0, 1], [1, 0, 4], [4, 1, 16],
      [6, 4, 16], [16, 4, 64], [16.01, 16, 64],
      [65535, 16384, 65536], [16777216, 4194304, 16777216],
    ]) {
      expect(stepPowerOfFourAmps(amps, -1)).toBe(down);
      expect(stepPowerOfFourAmps(amps, 1)).toBe(up);
    }
    expect(Number.isFinite(stepPowerOfFourAmps(Number.MAX_VALUE, 1))).toBe(true);
  });
  it("assumes legal voltage in raw mode while preserving the exact available power", () => {
    const r = recipe("Industrial Arc Furnace", 120);
    const lowTier = node({ hatchVoltageTier: "ULV", hatchAmps: 1000 / 8 });
    expect(getNodePowerReport(r, lowTier).state).toBe("over-tier");
    const raw = { ...lowTier, powerInputMode: "eut" as const };
    const report = getNodePowerReport(r, raw);
    expect(report.state).toBe("ok");
    expect(report.poolEuT).toBe(1000);
    expect(getNodePowerReport(r, { ...raw, hatchAmps: 0 }).state).toBe("under-powered");
    const tiny = getNodePowerReport(r, { ...raw, hatchAmps: 1 / 8 });
    expect(tiny.state).toBe("under-powered");
    expect(tiny.poolEuT).toBe(1);
    const explicit = {
      ...raw,
      powerInputMode: "amps" as const,
      hatchVoltageTier: report.tier,
      hatchAmps: report.amps,
    };
    expect(getOverclockedRecipeStats(r, raw)).toEqual(getOverclockedRecipeStats(r, explicit));
  });
  it("keeps raw and explicit hatch power ladders separate", () => {
    const r = recipe("Industrial Arc Furnace", 120);
    const n = node({ hatchVoltageTier: "ULV", hatchAmps: 100 });
    expect(listPowerWinsCached(r, n)).toHaveLength(0);
    expect(listPowerWinsCached(r, { ...n, powerInputMode: "eut" })).not.toHaveLength(0);
  });
});
