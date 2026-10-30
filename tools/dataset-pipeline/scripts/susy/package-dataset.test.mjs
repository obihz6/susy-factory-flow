import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { writeDatasetJson } from "../dataset-json-writer.mjs";

const execFileAsync = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "package-dataset.mjs");
const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "susy-package-"));
  tempDirs.push(root);
  const datasetDir = path.join(root, "datasets", "stable-fixture");
  await fs.mkdir(datasetDir, { recursive: true });

  await writeDatasetJson(path.join(datasetDir, "recipes.json"), {
    schemaVersion: 1,
    datasetVersionId: "stable-fixture",
    gtnhVersion: "1.0.0",
    sourceInfo: { sourceId: "susy-oracle", generatedAt: "2026-10-30T00:00:00.000Z" },
    resources: [{ id: "minecraft:stone" }],
    recipes: [
      { id: "recipe-1", machineType: "Assembler", durationTicks: 20, eut: 8, inputs: [], outputs: [] },
    ],
    oreDictionary: { iron: ["oreIron"] },
    recipeMaps: ["Assembler"],
    generatedAt: "2026-10-30T00:00:00.000Z",
  });

  // The manifest rebuild skips versions whose compressed indexes are missing.
  for (const name of ["resource-index", "recipe-index", "recipe-lookup-index"]) {
    await fs.writeFile(path.join(datasetDir, `${name}.json.gz`), gzipSync('{"entries":[]}'));
  }

  const configPath = path.join(root, "susy-pipeline.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        pack: { repository: "SymmetricDevs/Supersymmetry", ref: "fixture", versionId: "stable-fixture" },
        paths: {
          tempDir: root,
          instanceDir: path.join(root, ".minecraft"),
          rawExportDir: path.join(root, "raw-export"),
          datasetRoot: path.join(root, "datasets"),
          datasetDir,
          recipesPath: path.join(datasetDir, "recipes.json"),
          compressedRecipesPath: path.join(datasetDir, "recipes.json.gz"),
        },
        settings: { retries: 1, bootstrap: false, useDownloadedInstance: false },
        state: { status: "created", currentStep: null, steps: {} },
      },
      null,
      2,
    )}\n`,
  );

  return { root, datasetDir, configPath };
}

describe("package dataset step", () => {
  it("imports cleanly, gzips the dataset, and rebuilds the manifest", async () => {
    const { datasetDir, configPath } = await writeFixture();
    // Missing ../lib/atomic-write.mjs and the wrong FileHandle.write signature
    // both surfaced only here, as a bare ERR_MODULE_NOT_FOUND at step 7/8.
    await execFileAsync(process.execPath, [scriptPath, "--config", configPath], { cwd: os.tmpdir() });

    const compressed = gunzipSync(await fs.readFile(path.join(datasetDir, "recipes.json.gz")));
    const dataset = JSON.parse(compressed.toString("utf8"));
    expect(dataset.datasetVersionId).toBe("stable-fixture");
    expect(dataset.recipes).toHaveLength(1);
    expect(dataset.oreDictionary).toEqual({ iron: ["oreIron"] });

    const manifest = JSON.parse(
      await fs.readFile(path.join(datasetDir, "..", "datasets.manifest.json"), "utf8"),
    );
    expect(manifest.versions.map((version) => version.id)).toEqual(["stable-fixture"]);
    expect(manifest.latestStableVersion).toBe("stable-fixture");

    const leftovers = (await fs.readdir(datasetDir)).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});
