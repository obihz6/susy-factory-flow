import path from "node:path";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  requireFile,
  runCommand,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

await executeStandaloneStep("normalize-textures", async (logger, config) => {
  const iconScript = path.join(
    repoRoot,
    "tools",
    "dataset-pipeline",
    "scripts",
    "susy",
    "apply-susy-icons.mjs",
  );
  const iconDir = path.join(config.paths.rawExportDir, "rendered-icons");
  requireFile(config.paths.recipesPath, "normalized recipe dataset");
  requireFile(path.join(iconDir, "icon-map.json"), "rendered item icon map");
  requireFile(path.join(iconDir, "fluid-icon-map.json"), "rendered fluid icon map");
  await runCommand(process.execPath, [
    iconScript,
    config.paths.recipesPath,
    iconDir,
    config.paths.datasetDir,
    "/datasets/susy",
  ], {
    logger,
    label: "Normalize and copy rendered SUSY textures",
    progress: "Normalizing textures",
  });
  return { texturesDir: path.join(config.paths.datasetDir, "textures") };
}, options);
