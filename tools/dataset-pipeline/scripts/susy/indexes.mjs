import path from "node:path";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  requireFile,
  runCommand,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

await executeStandaloneStep("indexes", async (logger, config) => {
  const scriptsDir = path.join(repoRoot, "tools", "dataset-pipeline", "scripts");
  requireFile(config.paths.recipesPath, "normalized recipe dataset");
  await runCommand(process.execPath, [
    path.join(scriptsDir, "build-resource-index.mjs"),
    config.paths.recipesPath,
  ], { logger, label: "Build resource index", progress: "Building resource index" });
  await runCommand(process.execPath, [
    path.join(scriptsDir, "build-recipe-index.mjs"),
    config.paths.recipesPath,
    config.paths.datasetDir,
  ], { logger, label: "Build recipe indexes and shards", progress: "Building recipe indexes" });
  return {
    resourceIndexPath: path.join(config.paths.datasetDir, "resource-index.json.gz"),
    recipeIndexPath: path.join(config.paths.datasetDir, "recipe-index.json.gz"),
    recipeLookupIndexPath: path.join(config.paths.datasetDir, "recipe-lookup-index.json.gz"),
  };
}, options);
