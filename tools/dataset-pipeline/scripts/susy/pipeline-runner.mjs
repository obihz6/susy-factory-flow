import path from "node:path";
import { setPipelineState } from "./pipeline-lib.mjs";

/**
 * Run the selected pipeline steps, leaving process and CLI concerns to the caller.
 * Config reload, execution, stale checks, prompts, and progress output are injected
 * so the scheduler can be tested without launching the dataset pipeline.
 */
export async function runPipelineSteps({
  steps,
  startIndex = 0,
  force = false,
  retries,
  config,
  loadConfig,
  runStep,
  isStepStale = async () => false,
  setState = setPipelineState,
  logger,
  renderProgress = () => {},
  askForRecovery = async () => false,
}) {
  let currentConfig = config;
  let halted = false;

  for (const step of steps.slice(startIndex)) {
    const previous = currentConfig.state?.steps?.[step];
    if (!force && previous?.status === "completed") {
      if (await isStepStale(step)) {
        logger.info(`Completed step ${step} is stale; rerunning it.`);
      } else {
        logger.info(`Skipping completed step ${step}. Use --force to run it again.`);
        continue;
      }
    }

    let completed = false;
    while (!completed) {
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        await setState(currentConfig, "running", step, { attempt, maxAttempts: retries });
        logger.info(`Starting step ${step} (attempt ${attempt}/${retries}).`);
        renderProgress(steps, step, "running");

        try {
          await runStep(step, currentConfig);
          currentConfig = await loadConfig();
          await setState(currentConfig, "completed", step, { attempt, maxAttempts: retries });
          logger.info(`Step ${step} completed.`);
          renderProgress(steps, step, "completed");
          completed = true;
          break;
        } catch (error) {
          currentConfig = await loadConfig().catch(() => currentConfig);
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Step ${step} attempt ${attempt} failed: ${message}`);
          await setState(currentConfig, "failed", step, {
            attempt,
            maxAttempts: retries,
            error: message,
          });
          if (attempt < retries) {
            logger.warn(`Retrying step ${step}; no later step will be skipped.`);
          }
        }
      }

      if (completed) break;

      const failed = currentConfig.state?.steps?.[step]?.error ?? "unknown error";
      await setState(currentConfig, "halted", step, {
        error: failed,
        message: "Pipeline halted after the configured retries.",
      });
      logger.error(`Pipeline halted at ${step} after ${retries} failed attempt(s).`);
      logger.error(
        `Check ${path.join(path.resolve(currentConfig.paths.tempDir), "logs", `${step}.log`)} and resolve the issue manually.`,
      );
      logger.error("Run the failed step manually, then rerun the pipeline to continue.");

      if (await askForRecovery(step)) {
        logger.info(`Recovery requested for ${step}; starting a new retry window.`);
        continue;
      }

      halted = true;
      break;
    }

    if (halted) break;
  }

  return { config: currentConfig, halted };
}
