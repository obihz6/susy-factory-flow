import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  runCommand,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

await executeStandaloneStep("extract", async (logger, config) => {
  // Kill any client launched by a previous failed attempt before starting a new one.
  const pidFile = path.join(config.paths.rawExportDir, "previous-client.pid");
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

  // Best-effort: clear any leftover Java processes that may hold the oracle jar locked.
  if (process.platform === "win32") {
    try {
      await runCommand("taskkill", ["/IM", "javaw.exe", "/T", "/F"], {
        logger,
        label: "Clear leftover Java processes",
        progress: undefined,
      });
    } catch {}
  }

  const runner = path.join(
    repoRoot,
    "tools",
    "dataset-pipeline",
    "scripts",
    "susy",
    process.platform === "win32" ? "run-susy-export.ps1" : "run-susy-export.sh",
  );
  const env = {
    SUSY_INSTANCE_DIR: config.paths.instanceDir,
    SUSY_DATASET_VERSION_ID: config.pack.versionId,
    SUSY_DATASET_VERSION_LABEL: config.pack.versionLabel,
    SUSY_DATASET_OUT_DIR: config.paths.datasetDir,
    SUSY_RAW_EXPORT_DIR: config.paths.rawExportDir,
    SUSY_EXPORT_PHASE: "extract",
  };

  const command = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = process.platform === "win32"
    ? ["-ExecutionPolicy", "Bypass", "-File", runner]
    : [runner];
  await runCommand(command, args, {
    logger,
    env,
    label: "Extract recipes and rendered icons from the SUSY client",
    progress: "Extracting game resources",
    shell: false,
  });
  return {
    rawRecipeDump: path.join(config.paths.rawExportDir, "recipedump.json"),
    renderedIconDir: path.join(config.paths.rawExportDir, "rendered-icons"),
  };
}, options);
