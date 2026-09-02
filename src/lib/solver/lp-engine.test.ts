import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FactoryProject } from "@/lib/model/types";
import { normalizeLoadedProject } from "@/lib/model/project-normalize";
import { calculateThroughput } from "./throughput";
import { activeLpEngine, initLpEngine, solveLpAuto } from "./lp-engine";
import { solveLp } from "./simplex";

/**
 * The engine switchboard: HiGHS must agree with the homegrown simplex.
 *
 * The doctrine locks each stage's objective VALUE, never its vertex, so any
 * optimal LP engine must produce the same books wherever the answer is
 * determined. The fixture solves run homegrown FIRST (before the wasm engine
 * loads), then again under HiGHS, and the two books must match to solver
 * dust. Vitest isolates test files, so switching the module-level engine
 * here cannot leak into the doctrine exam.
 */

const FIXTURES = ["pa-cell-loop-plan.json", "pa-cell-loop-plan-3x.json"];

function loadFixture(name: string): FactoryProject {
  const raw = JSON.parse(
    readFileSync(path.join(__dirname, "__fixtures__", name), "utf8"),
  ) as FactoryProject;
  return normalizeLoadedProject(raw);
}

describe("lp-engine", () => {
  const homegrownBooks = new Map<string, ReturnType<typeof calculateThroughput>>();

  beforeAll(async () => {
    expect(activeLpEngine()).toBe("simplex");
    for (const name of FIXTURES) {
      homegrownBooks.set(name, calculateThroughput(loadFixture(name)));
    }
    const loaded = await initLpEngine();
    expect(loaded).toBe(true);
    expect(activeLpEngine()).toBe("highs");
  });

  it("solves a plain LP like the homegrown engine", () => {
    const lp = {
      maximize: [3, 2],
      equalities: [],
      upperBounds: [
        { coefficients: new Map([[0, 1], [1, 1]]), rhs: 4 },
        { coefficients: new Map([[0, 1], [1, 3]]), rhs: 6 },
      ],
    };
    const ours = solveLp(lp);
    const theirs = solveLpAuto(lp);
    expect(theirs.status).toBe("optimal");
    expect(theirs.objective).toBeCloseTo(ours.objective, 9);
  });

  it("reports infeasible the same way", () => {
    const lp = {
      maximize: [1],
      equalities: [{ coefficients: new Map([[0, 1]]), rhs: 5 }],
      upperBounds: [{ coefficients: new Map([[0, 1]]), rhs: 2 }],
    };
    expect(solveLpAuto(lp).status).toBe("infeasible");
    expect(solveLp(lp).status).toBe("infeasible");
  });

  for (const name of FIXTURES) {
    it(`agrees with the homegrown books on ${name}`, () => {
      const ours = homegrownBooks.get(name)!;
      const theirs = calculateThroughput(loadFixture(name));
      for (const [id, node] of Object.entries(ours.nodes)) {
        expect(
          Math.abs((theirs.nodes[id]?.utilization ?? 0) - (node.utilization ?? 0)),
          `utilization of ${id}`,
        ).toBeLessThan(1e-4);
      }
      for (const [id, edge] of Object.entries(ours.edges)) {
        const scale = Math.max(1, Math.abs(edge.transferredPerSecond));
        expect(
          Math.abs((theirs.edges[id]?.transferredPerSecond ?? 0) - edge.transferredPerSecond) /
            scale,
          `flow of ${id}`,
        ).toBeLessThan(1e-4);
      }
      expect(Math.abs(theirs.totalEuT - ours.totalEuT) / Math.max(1, ours.totalEuT)).toBeLessThan(
        1e-6,
      );
    });
  }
});
