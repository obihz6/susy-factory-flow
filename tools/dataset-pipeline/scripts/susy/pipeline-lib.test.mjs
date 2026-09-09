import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialConfig,
  getConfigPath,
  logPath,
  parseCliArgs,
  pipelineStepScriptName,
  updateConfigPaths,
} from "./pipeline-lib.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("SUSY pipeline configuration", () => {
  it("keeps config, logs, and raw artifacts under the selected temp directory", () => {
    const tempDir = path.join(os.tmpdir(), `susy-pipeline-${Date.now()}`);
    temporaryDirectories.push(tempDir);
    const config = createInitialConfig({
      tempDir,
      datasetRoot: path.join(tempDir, "datasets"),
      versionId: "0.1.16.14.1",
      versionLabel: "SUSY 0.1.16.14.1",
    });

    expect(config.paths.tempDir).toBe(tempDir);
    expect(config.paths.rawExportDir).toBe(path.join(tempDir, "raw-export"));
    expect(config.paths.recipesPath).toBe(
      path.join(tempDir, "datasets", "0.1.16.14.1", "recipes.json"),
    );
    expect(logPath(config, "extract")).toBe(path.join(tempDir, "logs", "extract.log"));
  });

  it("recalculates dataset paths when the version changes", () => {
    const config = createInitialConfig({
      tempDir: "temp",
      datasetRoot: "datasets",
      versionId: "old",
    });
    config.pack.versionId = "new";
    updateConfigPaths(config);

    expect(config.paths.datasetDir).toBe(path.resolve("datasets", "new"));
    expect(config.paths.compressedRecipesPath).toBe(
      path.resolve("datasets", "new", "recipes.json.gz"),
    );
  });

  it("parses positional commands and both flag forms", () => {
    const options = parseCliArgs([
      "build",
      "--version",
      "0.1.16.14.1",
      "--retries=2",
      "--no-bootstrap",
    ]);

    expect(options.positionals).toEqual(["build"]);
    expect(options.version).toBe("0.1.16.14.1");
    expect(options.retries).toBe("2");
    expect(options["no-bootstrap"]).toBe(true);
  });

  it("resolves an explicit config path", () => {
    expect(getConfigPath({ config: "temp/custom.json" })).toBe(
      path.resolve("temp/custom.json"),
    );
  });

  it("maps the package pipeline step to its actual script name", () => {
    expect(pipelineStepScriptName("package")).toBe("package-dataset.mjs");
    expect(pipelineStepScriptName("normalize")).toBe("normalize.mjs");
  });
});
