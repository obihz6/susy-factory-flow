import { describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeDatasetJson } from "../scripts/dataset-json-writer.mjs";
import { parseRecipeDatasetJson, parseDatasetManifestJson } from "../../../src/lib/import-export/dataset-json";
import { recipeDatasetSchema, datasetManifestSchema } from "../../../src/lib/datasets/schemas";
import { DatasetJsonError } from "../../../src/lib/import-export/dataset-json";

const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gtnh-contract-"));

describe("pipeline ↔ dataset schema contract", () => {
  it("accepts a writer-produced dataset that keeps oreDictionary (P-14)", async () => {
    const dataset = {
      schemaVersion: 1,
      datasetVersionId: "stable-contract",
      gtnhVersion: "1.16.0",
      sourceInfo: { sourceId: "gtnh-oracle", generatedAt: "2026-10-29T00:00:00.000Z" },
      resources: [],
      recipes: [
        {
          id: "recipe-1",
          name: "Assembler in/out",
          machineType: "Assembler",
          minimumTier: "LV",
          durationTicks: 10,
          eut: 8,
          inputs: [{ kind: "item", id: "gregtech:gt.metaitem.01@1", amount: 2 }],
          outputs: [{ kind: "item", id: "minecraft:stone", amount: 1 }],
        },
      ],
      oreDictionary: { iron: ["oreIron", "oreIronDust"] },
      recipeMaps: ["Assembler"],
      generatedAt: "2026-10-29T00:00:00.000Z",
    };

    const datasetPath = path.join(tempDir, "recipes.json");
    await writeDatasetJson(datasetPath, dataset);
    const source = await fsp.readFile(datasetPath, "utf8");
    const parsed = parseRecipeDatasetJson(source);

    expect(parsed.datasetVersionId).toBe("stable-contract");
    expect(parsed.oreDictionary.iron).toEqual(["oreIron", "oreIronDust"]);
    expect(parsed.resourceIndex).toBeUndefined();
  });

  it("round-trips a streamed (multi-line object) oreDictionary through the writer and schema", async () => {
    const dataset = {
      schemaVersion: 1,
      datasetVersionId: "stable-stream",
      gtnhVersion: "1.16.0",
      sourceInfo: { sourceId: "gtnh-oracle", generatedAt: "2026-10-29T00:00:00.000Z" },
      recipes: [],
      oreDictionary: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`item${index}`, [String(index)]])),
      recipeMaps: [],
      generatedAt: "2026-10-29T00:00:00.000Z",
    };

    const datasetPath = path.join(tempDir, "recipes-stream.json");
    await writeDatasetJson(datasetPath, dataset);
    const parsed = parseRecipeDatasetJson(await fsp.readFile(datasetPath, "utf8"));
    expect(Object.keys(parsed.oreDictionary)).toHaveLength(40);
  });

  it("rejects a manifest version that is missing required fields", () => {
    const invalid = {
      schemaVersion: 1,
      versions: [
        {
          id: "stable-x",
          channel: "stable",
          publishedAt: "2026-10-29T00:00:00.000Z",
          manifestPath: "/datasets/susy/datasets.manifest.json",
          recipeDatasetPath: "/datasets/susy/stable-x/recipes.json.gz",
          sourceInfo: { sourceId: "gtnh-oracle", generatedAt: "2026-10-29T00:00:00.000Z" },
        },
      ],
    };

    expect(() => parseDatasetManifestJson(JSON.stringify(invalid))).toThrow(DatasetJsonError);
    expect(() => recipeDatasetSchema.parse(invalid)).toThrowError();
    expect(datasetManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a manifest version with all required contract fields", () => {
    const valid = {
      schemaVersion: 1,
      latestStableVersion: "stable-x",
      versions: [
        {
          id: "stable-x",
          gtnhVersion: "1.16.0",
          channel: "stable",
          publishedAt: "2026-10-29T00:00:00.000Z",
          manifestPath: "/datasets/susy/datasets.manifest.json",
          recipeDatasetPath: "/datasets/susy/stable-x/recipes.json.gz",
          resourceIndexPath: "/datasets/susy/stable-x/resource-index.json.gz",
          recipeIndexPath: "/datasets/susy/stable-x/recipe-index.json.gz",
          recipeLookupIndexPath: "/datasets/susy/stable-x/recipe-lookup-index.json.gz",
          checksumSha256: "abc",
          sourceInfo: { sourceId: "gtnh-oracle", generatedAt: "2026-10-29T00:00:00.000Z" },
        },
      ],
    };

    expect(() => parseDatasetManifestJson(JSON.stringify(valid))).not.toThrow();
    expect(datasetManifestSchema.safeParse(valid).success).toBe(true);
  });
});
