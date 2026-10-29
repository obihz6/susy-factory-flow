/**
 * SuSy dataset generation entry point.
 *
 *   node tools/dataset-pipeline/scripts/generate-dataset.mjs
 *     -> run the SuSy pipeline chain (delegates to scripts/susy/orchestrator.mjs build).
 *   node tools/dataset-pipeline/scripts/generate-dataset.mjs --dry-run
 *     -> print the planned steps and exit without touching disk.
 *   node tools/dataset-pipeline/scripts/generate-dataset.mjs --verify [dataset-dir]
 *     -> validate an existing dataset directory against the dataset contract.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { parseCliArgs, repoRoot } from "./susy/pipeline-lib.mjs";

const options = parseCliArgs();

const dryRun = options["dry-run"] === true;

if (dryRun) {
  process.stdout.write(
    [
      "SuSy dataset pipeline dry run.",
      "Would run:",
      "  download -> build-oracle -> extract -> normalize -> normalize-textures -> merge-custom -> indexes -> package",
      "No files were written.",
    ].join("\n") + "\n",
  );
  process.exit(0);
}

const verifyDir =
  typeof options["verify"] === "string"
    ? path.resolve(options["verify"])
    : path.join(repoRoot, "public", "datasets", "susy");

if (options["verify"] !== undefined) {
  const requiredKeys = [
    "schemaVersion",
    "datasetVersionId",
    "gtnhVersion",
    "sourceInfo",
    "recipes",
    "oreDictionary",
    "recipeMaps",
    "generatedAt",
  ];
  const missing = (dataset) => requiredKeys.filter((key) => dataset[key] === undefined);

  const recipesPath = path.join(verifyDir, "recipes.json.gz");
  const recipesRaw = await fs.readFile(recipesPath);
  const dataset = JSON.parse(gunzipSync(recipesRaw).toString("utf8"));
  const missingKeys = missing(dataset);
  if (missingKeys.length > 0) {
    process.stderr.write(`Dataset verification failed: missing keys ${missingKeys.join(", ")} in ${recipesPath}.\n`);
    process.exit(1);
  }

  process.stdout.write(
    `Dataset verification ok: ${dataset.datasetVersionId} from ${dataset.gtnhVersion} (${Object.keys(dataset.oreDictionary).length} ore-dict entries, ${dataset.recipes.length} recipes).\n`,
  );
  process.exit(0);
}

const childArgs = [
  "build",
  ...(options["version-id"] ? ["--version-id", String(options["version-id"])] : []),
  ...(options["version"] ? ["--version", String(options["version"])] : []),
  ...(options["version-label"] ? ["--version-label", String(options["version-label"])] : []),
  ...(options["ref"] ? ["--ref", String(options["ref"])] : []),
  ...(options["dataset-root"] ? ["--dataset-root", String(options["dataset-root"])] : []),
  ...(options["temp"] ? ["--temp", String(options["temp"])] : []),
  ...(options["instance"] ? ["--instance", String(options["instance"])] : []),
];

const orchestratorScript = path.join(
  repoRoot,
  "tools",
  "dataset-pipeline",
  "scripts",
  "susy",
  "orchestrator.mjs",
);
const orchestrator = spawn(process.execPath, [orchestratorScript, ...childArgs], {
  stdio: "inherit",
});

orchestrator.on("exit", (code) => {
  process.exit(code ?? 1);
});
