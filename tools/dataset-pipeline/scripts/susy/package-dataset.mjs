import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  requireFile,
  runCommand,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

await executeStandaloneStep("package", async (logger, config) => {
  requireFile(config.paths.recipesPath, "normalized recipe dataset");
  const compressedPath = config.paths.compressedRecipesPath;
  await fs.mkdir(path.dirname(compressedPath), { recursive: true });
  await pipeline(
    createReadStream(config.paths.recipesPath),
    createGzip({ level: 9 }),
    createWriteStream(compressedPath),
  );
  logger.info(`Compressed dataset to ${compressedPath}.`);

  const manifestScript = path.join(
    repoRoot,
    "tools",
    "dataset-pipeline",
    "scripts",
    "rebuild-manifest.mjs",
  );
  await runCommand(process.execPath, [manifestScript], {
    logger,
    env: {
      DATASETS_ROOT: config.paths.datasetRoot,
      DATASETS_URL_ROOT: "/datasets/susy",
    },
    label: "Rebuild the SUSY dataset manifest",
    progress: "Writing dataset manifest",
  });
  return { compressedRecipesPath: compressedPath, manifestPath: path.join(config.paths.datasetRoot, "datasets.manifest.json") };
}, options);
