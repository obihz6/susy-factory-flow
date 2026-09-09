import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as readline from "node:readline/promises";
import {
  createInitialConfig,
  createLogger,
  defaultConfigPath,
  defaultTempDir,
  getConfigPath,
  loadConfig,
  parseCliArgs,
  positiveInteger,
  pipelineStepScriptName,
  repoRoot,
  runCommand,
  saveConfig,
  setPipelineState,
  updateConfigPaths,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();
const command = options.positionals[0] ?? "build";
if (command === "help" || command === "--help" || options.help === true) {
  printUsage();
  process.exit(0);
}
const stepNames = ["download", "build-oracle", "extract", "normalize", "normalize-textures", "merge-custom", "indexes", "package"];
const steps = command === "build" || command === "all" ? stepNames : [command];
if (steps.some((step) => !stepNames.includes(step))) {
  printUsage();
  throw new Error(`Unknown pipeline command: ${command}.`);
}

const configPath = getConfigPath(options);

let config;
try {
  config = await loadConfig({ config: configPath });
  const previousVersionId = config.pack?.versionId;
  applyCliOverrides(config, options);
  applySavedVersionSelection(config, options);
  updateConfigPaths(config);
  if (previousVersionId !== config.pack?.versionId) {
    config.state = { status: "created", currentStep: null, steps: {} };
  }
  await saveConfig(config);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  config = createInitialConfig({
    config: configPath,
    tempDir: options.temp ?? defaultTempDir,
    datasetRoot: options["dataset-root"],
    instance: options.instance ?? process.env.SUSY_INSTANCE_DIR,
    version: options.version,
    versionId: options["version-id"] ?? (options.version && options["version-label"] ? undefined : options.version),
    versionLabel: options["version-label"],
    ref: options.ref ?? options.version,
    retries: options.retries,
    bootstrap: !options["no-bootstrap"],
  });
  config.configPath = configPath;
  config.settings.instanceExplicit = Boolean(options.instance || process.env.SUSY_INSTANCE_DIR);
  applySavedVersionSelection(config, options);
  await saveConfig(config);
}

const logger = createLogger(path.join(path.resolve(config.paths.tempDir), "logs", "orchestrator.log"));
const retries = positiveInteger(options.retries ?? config.settings?.retries, 3);
const selectedPublishedVersions = Array.isArray(config.selectedVersions)
  ? config.selectedVersions.filter((version) => !config.localDevVersions?.includes(version))
  : [];
const force = options.force === true || options.force === "true";
const requestedStartIndex = options.from ? steps.indexOf(String(options.from)) : 0;
if (options.from && requestedStartIndex === -1) {
  logger.close();
  throw new Error(`Unknown starting step: ${options.from}.`);
}
const startIndex = Math.max(0, requestedStartIndex);

if (options.from && startIndex === -1) {
  logger.close();
  throw new Error(`Unknown starting step: ${options.from}.`);
}

let halted = false;

try {
  logger.info(`SUSY pipeline started (${command}).`);
  logger.info(`Configuration: ${config.configPath ?? configPath}`);
  logger.info(`Logs: ${path.join(path.resolve(config.paths.tempDir), "logs")}`);
  logger.info(`Steps: ${steps.slice(startIndex).join(" -> ")}`);
  let delegatedVersions = false;
  if ((command === "build" || command === "all") && startIndex === 0 && selectedPublishedVersions.length > 1 && options["single-version"] !== true) {
    delegatedVersions = true;
    await runSelectedVersions(selectedPublishedVersions, config, logger);
  } else if (Array.isArray(config.selectedVersions) && config.selectedVersions.length > 1) {
    logger.info(`Multiple versions are selected; running the configured version only.`);
  }

  for (const step of delegatedVersions ? [] : steps.slice(startIndex)) {
    const previous = config.state?.steps?.[step];
    if (!force && previous?.status === "completed") {
      if (await isStepStale(step)) {
        logger.info(`Completed step ${step} is stale; rerunning it.`);
      } else {
        logger.info(`Skipping completed step ${step}. Use --force to run it again.`);
        continue;
      }
    }

    let completed = false;
    let haltedAtStep = false;
    while (!completed && !haltedAtStep) {
      for (let attempt = 1; attempt <= retries; attempt += 1) {
      await setPipelineState(config, "running", step, { attempt, maxAttempts: retries });
      logger.info(`Starting step ${step} (attempt ${attempt}/${retries}).`);
      renderOverallProgress(steps, step, "running");
      try {
        // For extract steps that launch a long-running client, check whether
        // a previous attempt left a running client behind and kill it so the
        // retry can install the oracle jar fresh.
        if (step === "extract") {
          const pidFile = path.join(path.resolve(config.paths.tempDir), "raw-export", "previous-client.pid");
          try {
            const pidText = await fs.readFile(pidFile, "utf8").catch(() => "");
            const pid = pidText.trim();
            if (/^\d+$/.test(pid)) {
              try {
                process.kill(Number(pid));
                logger.info(`Killed previously launched client (PID ${pid}) from a failed attempt.`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
              } catch {
                // Process already exited or we don't have permission.
              }
            }
          } catch {}
          // Best-effort: also kill any remaining Prism/Minecraft processes that
          // may still hold the oracle jar locked on Windows.
          if (process.platform === "win32") {
            try {
              await runCommand("taskkill", ["/IM", "javaw.exe", "/T", "/F"], {
                logger,
                label: "Clear leftover Java processes",
                progress: undefined,
              });
            } catch {}
          }
        }
        await runStep(step, config.configPath ?? configPath, logger);
        config = await loadConfig({ config: configPath });
        await setPipelineState(config, "completed", step, { attempt, maxAttempts: retries });
        logger.info(`Step ${step} completed.`);
        renderOverallProgress(steps, step, "completed");
        completed = true;
        break;
      } catch (error) {
        config = await loadConfig({ config: configPath }).catch(() => config);
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Step ${step} attempt ${attempt} failed: ${message}`);
        await setPipelineState(config, "failed", step, {
          attempt,
          maxAttempts: retries,
          error: message,
        });
        if (attempt < retries) {
          logger.warn(`Retrying step ${step}; no later step will be skipped.`);
        }
      }
      }

      if (!completed) {
        const failed = config.state?.steps?.[step]?.error ?? "unknown error";
        await setPipelineState(config, "halted", step, {
          error: failed,
          message: "Pipeline halted after the configured retries.",
        });
        logger.error(`Pipeline halted at ${step} after ${retries} failed attempt(s).`);
        logger.error(`Check ${path.join(path.resolve(config.paths.tempDir), "logs", `${step}.log`)} and resolve the issue manually.`);
        logger.error("Run the failed step manually, then rerun the pipeline to continue.");
        if (await askForRecovery(step)) {
          logger.info(`Recovery requested for ${step}; starting a new retry window.`);
          continue;
        }
        process.exitCode = 1;
        haltedAtStep = true;
        halted = true;
      }

      // A failed step is a hard pipeline boundary. The recovery prompt may
      // start another retry window, but once the user declines recovery we
      // must not fall through to downstream steps with missing artifacts.
      if (halted) {
        break;
      }
    }

    // Stop the outer step loop too. Without this break, a declined recovery
    // prompt still allowed normalize/index/package to run against artifacts
    // that the failed step never produced.
    if (halted) {
      break;
    }
  }

  if (!halted) {
    await setPipelineState(config, "completed", null);
    logger.info("SUSY pipeline completed successfully.");
    renderOverallProgress(steps, steps.at(-1), "completed");
    await offerDownloadedInstanceCleanup(config, logger);
  }
} finally {
  logger.close();
}

async function isStepStale(step) {
  if (step !== "build-oracle") {
    return false;
  }

  const jarDir = path.join(repoRoot, "tools", "dataset-pipeline", "susy-hei-oracle", "build", "libs");
  let jarStats;
  try {
    const jars = (await fs.readdir(jarDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jar") && !entry.name.endsWith("-sources.jar"));
    if (jars.length === 0) return true;
    jarStats = await Promise.all(jars.map(async (entry) => ({
      path: path.join(jarDir, entry.name),
      mtimeMs: (await fs.stat(path.join(jarDir, entry.name))).mtimeMs,
    })));
  } catch {
    return true;
  }

  const newestJar = Math.max(...jarStats.map((entry) => entry.mtimeMs));
  const sourceRoot = path.join(repoRoot, "tools", "dataset-pipeline", "susy-hei-oracle", "src");
  let newestSource = 0;
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (/\.(java|gradle|properties|json)$/.test(entry.name)) {
        try {
          newestSource = Math.max(newestSource, (await fs.stat(fullPath)).mtimeMs);
        } catch {
          // A source removed during a build does not make the old jar stale.
        }
      }
    }
  }
  await visit(sourceRoot);
  return newestSource > newestJar;
}

async function runSelectedVersions(versionIds, parentConfig, logger) {
  for (const versionId of versionIds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(versionId)) {
      throw new Error(`Invalid selected version id: ${versionId}`);
    }
    const childConfig = path.join(parentConfig.paths.tempDir, "version-runs", `${versionId}.json`);
    const childArgs = [
      path.join(repoRoot, "tools", "dataset-pipeline", "scripts", "susy", "orchestrator.mjs"),
      "build",
      "--config", childConfig,
      "--temp", parentConfig.paths.tempDir,
      "--dataset-root", parentConfig.paths.datasetRoot,
      "--version-id", versionId,
      "--ref", versionId,
      "--version-label", versionId,
      "--force",
      "--single-version",
      "--interactive", "false",
    ];
    if (parentConfig.settings?.bootstrap === false) childArgs.push("--no-bootstrap");
    if (parentConfig.settings?.instanceExplicit) childArgs.push("--instance", parentConfig.paths.instanceDir);
    logger.info(`Building selected version ${versionId}.`);
    await runCommand(process.execPath, childArgs, {
      logger,
      label: `Build selected version ${versionId}`,
      progress: `Building ${versionId}`,
    });
  }
}

async function runStep(step, configFile, parentLogger) {
  const scriptName = pipelineStepScriptName(step);
  const script = path.join(
    repoRoot,
    "tools",
    "dataset-pipeline",
    "scripts",
    "susy",
    scriptName,
  );
  await runCommand(process.execPath, [script, "--config", configFile], {
    logger: parentLogger,
    label: `Run ${scriptName}`,
    progress: `Pipeline step: ${step}`,
  });
}

function applySavedVersionSelection(config, cli) {
  if (cli.version || cli["version-id"] || !Array.isArray(config.selectedVersions) || config.selectedVersions.length === 0) {
    return;
  }
  const selected = String(config.selectedVersions[0]);
  const isLocal = config.localDevVersions?.includes(selected);
  if (isLocal) {
    // Local versions are editor inputs, not client-export refs. Keep them in
    // the selection state and leave the normal extraction config unchanged.
    return;
  }
  if (config.pack.versionId !== selected) {
    config.pack.versionId = selected;
    config.pack.ref = selected;
    config.pack.versionLabel = undefined;
    config.state = { status: "created", currentStep: null, steps: {} };
  }
}

function applyCliOverrides(config, cli) {
  if (cli.version || cli["version-id"]) {
    config.pack.versionId = String(cli["version-id"] ?? cli.version);
    config.pack.ref = String(cli.ref ?? cli.version ?? config.pack.ref ?? "");
  }
  if (cli.ref) config.pack.ref = String(cli.ref);
  if (cli["version-label"]) config.pack.versionLabel = String(cli["version-label"]);
  if (cli.instance) {
    config.paths.instanceDir = path.resolve(String(cli.instance));
    config.settings.instanceExplicit = true;
  } else if (process.env.SUSY_INSTANCE_DIR) {
    config.paths.instanceDir = path.resolve(process.env.SUSY_INSTANCE_DIR);
    config.settings.instanceExplicit = true;
  }
  if (cli["dataset-root"]) config.paths.datasetRoot = path.resolve(String(cli["dataset-root"]));
  if (cli.temp) {
    config.paths.tempDir = path.resolve(String(cli.temp));
    config.paths.rawExportDir = path.join(config.paths.tempDir, "raw-export");
  }
  if (cli["no-bootstrap"]) config.settings.bootstrap = false;
  if (cli.retries) config.settings.retries = positiveInteger(cli.retries, 3);
}

function renderOverallProgress(allSteps, activeStep, status) {
  const activeIndex = allSteps.indexOf(activeStep);
  if (activeIndex < 0) return;
  const completed = status === "completed" ? activeIndex + 1 : activeIndex;
  const width = 24;
  const ratio = completed / allSteps.length;
  const filled = Math.round(width * ratio);
  const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  process.stdout.write(`\rOverall [${bar}] ${completed}/${allSteps.length} (${status}: ${activeStep})`);
  if (status === "completed" && completed === allSteps.length) process.stdout.write("\n");
}

async function offerDownloadedInstanceCleanup(currentConfig, parentLogger) {
  const settings = currentConfig.settings ?? {};
  const instanceDir = currentConfig.paths?.instanceDir;
  const isDownloaded = settings.useDownloadedInstance !== false &&
    settings.instanceSource === "bootstrap" && instanceDir;
  if (!isDownloaded) return;

  if (options.interactive === false || !process.stdin.isTTY || !process.stdout.isTTY) {
    parentLogger.info(`Downloaded SUSY instance retained at ${instanceDir}.`);
    return;
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `The downloaded SUSY instance is at ${instanceDir}. Delete it and its runtime, or keep it? [keep/delete] `,
    );
    if (!/^(delete|d|yes|y)$/i.test(answer.trim())) {
      parentLogger.info(`Downloaded SUSY instance retained at ${instanceDir}.`);
      currentConfig.settings.downloadedInstanceStatus = "kept";
      await saveConfig(currentConfig);
      return;
    }

    const runtimeDir = `${instanceDir}-runtime`;
    await fs.rm(instanceDir, { recursive: true, force: true });
    await fs.rm(runtimeDir, { recursive: true, force: true });
    currentConfig.settings.downloadedInstanceStatus = "deleted";
    await saveConfig(currentConfig);
    parentLogger.info(`Deleted downloaded SUSY instance and runtime: ${instanceDir}, ${runtimeDir}.`);
  } catch (error) {
    parentLogger.warn(`Could not apply downloaded-instance cleanup choice: ${error.message}`);
  } finally {
    prompt.close();
  }
}

async function askForRecovery(step) {
  if (options.interactive === false || !process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `Fix ${step} manually, then type "retry" to continue or press Enter to stop: `,
    );
    return /^(retry|continue|r)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function printUsage() {
  process.stderr.write(
    [
      "Usage: npm run pipeline -- [build|download|build-oracle|extract|normalize|normalize-textures|merge-custom|indexes|package] [options]",
      "",
      "Options:",
      "  --version <ref>          Build a specific Supersymmetry version/ref",
      "  --version-id <id>        Dataset output id",
      "  --version-label <label>  Dataset display label",
      "  --ref <tag|branch>       Pack repository ref",
      "  --instance <directory>   Existing Supersymmetry instance",
      "  --dataset-root <dir>     Dataset output root",
      "  --temp <dir>             Log and intermediate-file root (default ./temp)",
      "  --from <step>            Resume from a specific step",
      "  --force                  Rerun completed steps",
      "  --retries <count>        Attempts per step (default 3)",
      "  --no-bootstrap           Do not download an instance when missing",
      `  --config <file>          Shared config (default ${defaultConfigPath})`,
    ].join("\n") + "\n",
  );
}
