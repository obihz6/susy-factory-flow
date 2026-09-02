import { describe, expect, it } from "vitest";
import { loadBiodieselDemoProject } from "@/examples";
import { parseFactoryProjectJson } from "@/lib/import-export";
import type { FactoryProject, ThroughputResult } from "@/lib/model/types";
import { getStorageRoles } from "@/lib/model/storage-role";
import { calculateThroughput } from "@/lib/solver";
import { deriveNodeVerdict, findUnwiredNodeIds } from "@/components/flow/node-verdict";
import { prepareTourProject, quietStage } from "./tour-plan-prep";
import titaniumSetup from "./__fixtures__/titanium-line-setup.json";

/**
 * The tour teaches you to read a factory, which only works if the factory it
 * opens is running - and if it does what the lesson SAYS it does. The copy in
 * `lessons.ts` was written off real solves of these two boards; these pins
 * are those solves, so a solver change that falsifies a step fails here
 * instead of on a player's screen.
 *
 * `__fixtures__/titanium-line-setup.json` is the posted setup the lesson
 * downloads (community id in tour-boards.ts), snapshotted 2026-08-20. If the
 * post is ever re-uploaded, refresh the fixture with it - the pins are about
 * the lesson's claims, and the lesson reads the LIVE post.
 */

function solve(project: FactoryProject): ThroughputResult {
  return calculateThroughput(project, { generatedAt: "fixed" });
}

function utilizationByNode(project: FactoryProject, result: ThroughputResult) {
  return new Map(project.nodes.map((node) => [node.id, result.nodes[node.id]?.utilization ?? 0]));
}

describe("the tour board", () => {
  it("is dead on arrival without closed boundaries", () => {
    const raw = loadBiodieselDemoProject();
    const result = solve(raw);
    expect(findUnwiredNodeIds(raw, result).length).toBeGreaterThan(0);
  });

  it("runs once its boundaries are declared", () => {
    const closed = prepareTourProject(loadBiodieselDemoProject());
    const result = solve(closed);

    expect(findUnwiredNodeIds(closed, result)).toEqual([]);
    // And actually turning over, not merely wired: a board of zeroes would
    // pass the check above and still teach nothing.
    const running = closed.nodes.filter(
      (node) => (result.nodes[node.id]?.utilization ?? 0) > 0.001,
    );
    expect(running.length).toBe(closed.nodes.length);
  });

  it("gives every added drawer its own place on the board", () => {
    // Piled on the origin they would sit on top of one another, which on a
    // lesson about reading the canvas is worse than not adding them.
    const closed = prepareTourProject(loadBiodieselDemoProject());
    const added = (closed.storages ?? []).filter((storage) => storage.id.startsWith("boundary-"));
    expect(added.length).toBeGreaterThan(0);
    const spots = new Set(added.map((storage) => `${storage.position.x},${storage.position.y}`));
    expect(spots.size).toBe(added.length);
  });

  it("holds every speed still when the fallback board's products go byproduct", () => {
    // The drawer lab's one experiment, on the board the lesson falls back to
    // without the network: the flip is bookkeeping, so nothing may slow.
    const closed = prepareTourProject(loadBiodieselDemoProject());
    const before = utilizationByNode(closed, solve(closed));
    const flipped = quietStage(closed);
    const after = utilizationByNode(flipped, solve(flipped));
    for (const node of closed.nodes) {
      expect(after.get(node.id)).toBeCloseTo(before.get(node.id) ?? 0, 9);
    }
  });
});

describe("the titanium line the lesson reads", () => {
  const titanium = prepareTourProject(
    parseFactoryProjectJson(JSON.stringify(titaniumSetup)),
  );
  const result = solve(titanium);
  const verdicts = new Map(
    titanium.nodes.map((node) => [node.id, deriveNodeVerdict(titanium, result, node.id)]),
  );

  it("has the bottleneck the walk flies to, at full speed", () => {
    // pickCards takes the first BOTTLENECK in node order, and the step says
    // "fully fed and running at 100%" - so the first one must really be full.
    const first = titanium.nodes.find((node) => verdicts.get(node.id)?.kind === "bottleneck");
    expect(first).toBeDefined();
    expect(result.nodes[first!.id]?.utilization ?? 0).toBeGreaterThanOrEqual(0.999);
  });

  it("has the blocked card with several inputs, one of them marked", () => {
    // "Only one input is the problem" needs a card with more than one input
    // and a named binding, or the point is invisible.
    const blocked = titanium.nodes
      .filter((node) => verdicts.get(node.id)?.kind === "blocked")
      .sort(
        (a, b) =>
          Object.keys(result.nodes[b.id]?.inputs ?? {}).length -
          Object.keys(result.nodes[a.id]?.inputs ?? {}).length,
      )[0];
    expect(blocked).toBeDefined();
    expect(Object.keys(result.nodes[blocked!.id]?.inputs ?? {}).length).toBeGreaterThanOrEqual(2);
    expect(verdicts.get(blocked!.id)?.binding).toBeDefined();
  });

  it("shows PACED somewhere, and none of the words the walk never explains", () => {
    const kinds = new Set([...verdicts.values()].map((verdict) => verdict.kind));
    // "Three more words" promises the reader will meet PACED on real boards;
    // it is on this one.
    expect(kinds.has("paced")).toBe(true);
    // And nothing on the pristine board may read as jammed or dead - the
    // lesson only DESCRIBES those states, it must not have to explain one.
    expect(kinds.has("clogged")).toBe(false);
    expect(kinds.has("clog-lock")).toBe(false);
    expect(kinds.has("dead-loop")).toBe(false);
    expect(kinds.has("unwired")).toBe(false);
  });

  it("feeds its byproduct drawers and passes its buffer straight through", () => {
    const roles = getStorageRoles(titanium);
    const inflowOf = (storageId: string) =>
      titanium.edges
        .filter((edge) => edge.target === storageId)
        .reduce((sum, edge) => sum + (result.edges[edge.id]?.transferredPerSecond ?? 0), 0);
    const outflowOf = (storageId: string) =>
      titanium.edges
        .filter((edge) => edge.source === storageId)
        .reduce((sum, edge) => sum + (result.edges[edge.id]?.transferredPerSecond ?? 0), 0);

    // "A Byproduct catches the spare": both byproduct drawers really catch.
    const byproducts = (titanium.storages ?? []).filter(
      (storage) => roles.get(storage.id) === "byproduct",
    );
    expect(byproducts.length).toBeGreaterThan(0);
    for (const drawer of byproducts) {
      expect(inflowOf(drawer.id)).toBeGreaterThan(0);
    }

    // "Today it stores nothing": the freezer drinks every ingot the furnace
    // makes, so the buffer is a pass-through with an empty bank.
    const buffers = (titanium.storages ?? []).filter(
      (storage) => roles.get(storage.id) === "buffer",
    );
    expect(buffers.length).toBeGreaterThan(0);
    for (const buffer of buffers) {
      const inflow = inflowOf(buffer.id);
      expect(inflow).toBeGreaterThan(0);
      expect(outflowOf(buffer.id)).toBeCloseTo(inflow, 6);
      // The prep unset the posted strict flag; the lesson describes the
      // plain buffer.
      expect(buffer.bufferMode).toBeUndefined();
    }
  });

  it("flips the pill without moving a single number", () => {
    // The drawer lab's whole point: product -> byproduct changes bookkeeping
    // and one word, never a speed.
    const flipped = quietStage(titanium);
    const flippedResult = solve(flipped);
    const before = utilizationByNode(titanium, result);
    const after = utilizationByNode(flipped, flippedResult);
    for (const node of titanium.nodes) {
      // Precision 6, not 9: the engine's lock rows carry 1e-9 of deliberate
      // slack, so equal-optimum solves may differ by that much in either run.
      expect(after.get(node.id)).toBeCloseTo(before.get(node.id) ?? 0, 6);
    }

    // And the one word: the freezer (the product drawer's feeder) reads
    // STARVED before and ON DEMAND after, exactly as the step narrates.
    const roles = getStorageRoles(titanium);
    const productDrawer = (titanium.storages ?? []).find(
      (storage) => roles.get(storage.id) === "product",
    );
    expect(productDrawer).toBeDefined();
    const freezerId = titanium.edges.find((edge) => edge.target === productDrawer!.id)?.source;
    expect(freezerId).toBeDefined();
    expect(verdicts.get(freezerId!)?.kind).toBe("starved");
    const flippedVerdict = deriveNodeVerdict(flipped, flippedResult, freezerId!);
    expect(flippedVerdict.kind).toBe("demand-set");
    // Above the "unused" threshold, so the card's word is ON DEMAND.
    expect(flippedVerdict.pct).toBeGreaterThan(0.05);
  });
});
