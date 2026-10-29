import { describe, expect, it } from "vitest";
import path from "node:path";
import fsp from "node:fs/promises";
import os from "node:os";
import { writeDatasetFile, readDatasetFile, readLineDelimitedDataset } from "./line-dataset.mjs";
import { writeDatasetJson } from "../scripts/dataset-json-writer.mjs";

const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gtnh-lines-"));

describe("line-dataset round trip", () => {
  it("preserves streamed top-level objects (oreDictionary) through plain and gz writes", async () => {
    const big = {};
    for (let index = 0; index < 40; index += 1) {
      big[`item${index}`] = index;
    }

    const dataset = {
      datasetVersionId: "stable-test",
      oreDictionary: { iron: "oreIron", copper: ["oreCopper", "oreCu"] },
      recipes: [
        { id: "r1", kind: "machine", inputs: [{ kind: "item", id: "iron" }] },
        { id: "r2", kind: "machine" },
      ],
      sourceInfo: { exporter: "gtnh-oracle", version: 2 },
      bigObject: big,
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    const plainPath = path.join(tempDir, "recipes.json");
    const gzPath = path.join(tempDir, "recipes.json.gz");
    await writeDatasetJson(plainPath, dataset);
    await writeDatasetFile(gzPath, dataset);

    const plainRead = await readLineDelimitedDataset(plainPath);
    const gzRead = await readDatasetFile(gzPath);

    expect(Object.keys(plainRead.oreDictionary).length).toBe(2);
    expect(Object.keys(plainRead.bigObject).length).toBe(40);
    expect(plainRead.recipes.length).toBe(2);
    expect(gzRead.oreDictionary).toEqual(dataset.oreDictionary);
    expect(gzRead.bigObject).toEqual(big);
  });
});
