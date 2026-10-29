import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic, writeFileAtomicJson } from "./atomic-write.mjs";

const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gtnh-atomic-"));

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes a file and leaves no temp file behind", async () => {
    const target = path.join(tempDir, "recipes.json");
    await writeFileAtomic(target, '{"datasetVersionId":"stable-test"}');

    const raw = await fsp.readFile(target, "utf8");
    expect(JSON.parse(raw).datasetVersionId).toBe("stable-test");
    expect(fs.readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans up the temp file when the write fails", async () => {
    const target = path.join(tempDir, "manifest.json");
    await expect(
      writeFileAtomic(target, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("writes a JSON payload atomically", async () => {
    const target = path.join(tempDir, "datasets.manifest.json");
    await writeFileAtomicJson(target, { schemaVersion: 1, versions: [] });

    const parsed = JSON.parse(await fsp.readFile(target, "utf8"));
    expect(parsed.schemaVersion).toBe(1);
  });
});
