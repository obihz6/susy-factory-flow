import path from "node:path";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  requireFile,
  runCommand,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

await executeStandaloneStep("normalize", async (logger, config) => {
  const inputPath = path.join(config.paths.rawExportDir, "recipedump.json");
  const script = path.join(
    repoRoot,
    "tools",
    "dataset-pipeline",
    "scripts",
    "susy",
    "normalize-susy-recipedump.mjs",
  );
  requireFile(inputPath, "SUSY recipe dump");
  if (!config.pack.versionId || !config.pack.versionLabel) {
    throw new Error("Dataset version id and label are required before normalization.");
  }
  await runCommand(process.execPath, [script, inputPath, config.paths.recipesPath], {
    logger,
    env: {
      SUSY_DATASET_VERSION_ID: config.pack.versionId,
      SUSY_DATASET_VERSION_LABEL: config.pack.versionLabel,
      SUSY_RENDERED_ICON_DIR: path.join(config.paths.rawExportDir, "rendered-icons"),
    },
    label: "Normalize the SUSY recipe dump",
    progress: "Normalizing recipes",
  });
  return { recipesPath: config.paths.recipesPath };
}, options);
