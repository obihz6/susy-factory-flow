/**
 * The arrange JOB: what an arrange is when it leaves the main thread, and
 * how it runs. Pure and worker-safe, and deliberately in its own file:
 * this is everything `arrange.worker.ts` needs, and it must not import
 * `arrange-solve.ts`, which is the module that SPAWNS the worker (a worker
 * bundle that reaches back into its spawner referenced itself and hung
 * Turbopack's production build - see grid-route-job.ts).
 *
 * The host cannot hand a worker its judge function, so it hands the
 * judge's INPUTS - the board's route requests, obstacles and tuning - and
 * the job builds the judge here (`makeRouteJudge`).
 */

import { arrangeBoard, type ArrangeInput, type ArrangeResult } from "./board-arrange";
import { makeRouteJudge } from "./route-judge";
import type { GridObstacle, GridRouteRequest } from "@/components/flow/grid-edge-router";
import type { RouterTuning } from "@/components/flow/router-tuning";

export interface ArrangeJudgeInput {
  obstacles: GridObstacle[];
  requests: GridRouteRequest[];
  tuning: RouterTuning;
}

export interface ArrangeJob {
  /** Monotonic; a result for an older job than the last asked is dropped. */
  seq: number;
  cards: ArrangeInput["cards"];
  wires: ArrangeInput["wires"];
  taste?: ArrangeInput["taste"];
  origin?: ArrangeInput["origin"];
  judgeInput?: ArrangeJudgeInput;
}

/**
 * THE STEPS of an arrange, in order, as the loader shows them (Jack,
 * 2026-09-08: "one master progress bar with steps and very distinct
 * things"). A progress message names its step; the loader fills one bar
 * across all of them, each step taking an equal share.
 */
export const ARRANGE_STEPS = [
  { key: "layout", label: "Laying the board out" },
  { key: "search", label: "Searching for a better layout" },
  { key: "route", label: "Routing the candidates" },
  { key: "polishFirst", label: "Polishing the first layout" },
  { key: "polishSecond", label: "Polishing the second layout" },
  { key: "choose", label: "Choosing the better board" },
] as const;

/** Where the arrange is, for the loader: a step, and how far along it. */
export interface ArrangeProgress {
  seq: number;
  /** Index into ARRANGE_STEPS. */
  step: number;
  stage: string;
  done: number;
  total: number;
}

export interface ArrangeJobResult {
  seq: number;
  result: ArrangeResult;
  arrangeMs: number;
}

/** Runs the job right here; the worker and the fallback both call this. */
export function runArrangeJob(
  job: ArrangeJob,
  onProgress?: (progress: ArrangeProgress) => void,
): ArrangeJobResult {
  const started = performance.now();
  const judge = job.judgeInput
    ? makeRouteJudge(job.judgeInput.obstacles, job.judgeInput.requests, job.judgeInput.tuning)
    : undefined;
  const result = arrangeBoard({
    cards: job.cards,
    wires: job.wires,
    taste: job.taste,
    origin: job.origin,
    judge,
    tuning: job.judgeInput?.tuning,
    onProgress: onProgress
      ? (progress) => onProgress({ seq: job.seq, ...progress })
      : undefined,
  });
  return { seq: job.seq, result, arrangeMs: performance.now() - started };
}
