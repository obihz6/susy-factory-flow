import { describe, expect, it, vi } from "vitest";
import { runPipelineSteps } from "./pipeline-runner.mjs";

function makeHarness(overrides = {}) {
  const config = {
    configPath: "/tmp/susy-pipeline.json",
    paths: { tempDir: "/tmp/susy-pipeline" },
    state: { steps: {} },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const setState = vi.fn(async (current, status, step, details = {}) => {
    if (step) {
      current.state.steps[step] = { ...current.state.steps[step], status, ...details };
    }
  });
  const runStep = vi.fn(async () => {});
  const loadConfig = vi.fn(async () => config);
  const runner = (options = {}) => runPipelineSteps({
    steps: ["download", "extract", "package"],
    retries: 2,
    config,
    logger,
    setState,
    loadConfig,
    runStep,
    ...overrides,
    ...options,
  });
  return { config, logger, loadConfig, runStep, runner, setState };
}

describe("runPipelineSteps", () => {
  it("skips completed steps unless forced", async () => {
    const { config, runStep, runner } = makeHarness();
    config.state.steps.download = { status: "completed" };

    const result = await runner({ steps: ["download"], isStepStale: async () => false });

    expect(result.halted).toBe(false);
    expect(runStep).not.toHaveBeenCalled();
  });

  it("reruns completed steps when forced", async () => {
    const { config, runStep, runner } = makeHarness();
    config.state.steps.download = { status: "completed" };

    await runner({ steps: ["download"], force: true });

    expect(runStep).toHaveBeenCalledOnce();
  });

  it("reruns completed but stale steps", async () => {
    const { config, runStep, runner } = makeHarness();
    config.state.steps.download = { status: "completed" };

    await runner({ steps: ["download"], isStepStale: async () => true });

    expect(runStep).toHaveBeenCalledOnce();
  });

  it("retries a failed step and continues after success", async () => {
    const { runStep, runner, logger } = makeHarness();
    runStep.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce();

    const result = await runner({ steps: ["download", "extract"] });

    expect(result.halted).toBe(false);
    expect(runStep.mock.calls.map(([step]) => step)).toEqual(["download", "download", "extract"]);
    expect(logger.warn).toHaveBeenCalledWith("Retrying step download; no later step will be skipped.");
  });

  it("halts after retries are exhausted and does not run later steps", async () => {
    const { config, runStep, runner } = makeHarness();
    runStep.mockRejectedValue(new Error("broken"));

    const result = await runner({ steps: ["download", "extract"] });

    expect(result.halted).toBe(true);
    expect(config.state.steps.download.status).toBe("halted");
    expect(runStep.mock.calls.map(([step]) => step)).toEqual(["download", "download"]);
  });

  it("starts a new retry window when recovery is accepted", async () => {
    const { runStep, runner } = makeHarness();
    runStep.mockRejectedValueOnce(new Error("first window failed"))
      .mockRejectedValueOnce(new Error("first window failed"))
      .mockResolvedValueOnce();

    const result = await runner({
      steps: ["download"],
      askForRecovery: vi.fn().mockResolvedValue(true),
    });

    expect(result.halted).toBe(false);
    expect(runStep).toHaveBeenCalledTimes(3);
  });

  it("starts from the requested step index", async () => {
    const { runStep, runner } = makeHarness();

    await runner({ startIndex: 1 });

    expect(runStep.mock.calls.map(([step]) => step)).toEqual(["extract", "package"]);
  });
});
