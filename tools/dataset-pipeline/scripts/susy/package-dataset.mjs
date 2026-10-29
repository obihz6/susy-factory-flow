import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Writable } from "node:stream";
import { writeFileAtomic } from "../lib/atomic-write.mjs";
import {
  executeStandaloneStep,
  parseCliArgs,
  repoRoot,
  requireFile,
  runCommand,
} from "./pipeline-lib.mjs";

const options = parseCliArgs();

class HandleSink extends Writable {
  constructor(handle) {
    super();
    this.handle = handle;
  }

  _write(chunk, encoding, callback) {
    this.handle.write(chunk, encoding, callback);
  }
}

await executeStandaloneStep("package", async (logger, config) => {
  requireFile(config.paths.recipesPath, "normalized recipe dataset");
  const compressedPath = config.paths.compressedRecipesPath;
  await fs.mkdir(path.dirname(compressedPath), { recursive: true });
  await writeFileAtomic(compressedPath, async (handle) => {
    const sink = new HandleSink(handle);
    await pipeline(
      createReadStream(config.paths.recipesPath),
      createGzip({ level: 9 }),
      sink,
    );
  });
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
