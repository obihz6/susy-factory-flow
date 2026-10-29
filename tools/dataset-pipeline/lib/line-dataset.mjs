/**
 * Shared line-oriented dataset reader.
 *
 * `dataset-json-writer.mjs` emits the dataset in a line-per-value format:
 * every top-level property is one line; arrays and streamed (>32-key)
 * objects put each element on its own line, with separators attached to the
 * end of the preceding line (verified against the writer output):
 *
 *   {
 *     "datasetVersionId": "stable-x",
 *     "recipes": [
 *       {...recipe row...},
 *       {...recipe row...}
 *     ],
 *     "oreDictionary": {
 *       "iron": "oreIron",
 *       ...
 *     },
 *     "generatedAt": "..."
 *   }
 *
 * P-14: older readers skipped every streamed top-level object, silently
 * dropping `oreDictionary` from the published dataset. The shared reader
 * captures streamed objects instead of skipping them.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { gunzipSync, gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { writeDatasetJson } from "../scripts/dataset-json-writer.mjs";
import { writeFileAtomic } from "./atomic-write.mjs";

export async function readDatasetFile(filePath) {
  if (filePath.endsWith(".gz")) {
    const data = await fs.readFile(filePath);
    return JSON.parse(gunzipSync(data).toString("utf8"));
  }
  return readLineDelimitedDataset(filePath);
}

/**
 * Rewrite the line-oriented dataset at `filePath`, preserving the per-line
 * contract even for `.gz` inputs (P-14 tail: a compact one-line `.gz`
 * emission breaks the manifest reader). The plain journal is staged as a
 * temp file, replaced with its gzip, and the gzip is renamed atomically.
 */
export async function writeDatasetFile(filePath, dataset) {
  if (filePath.endsWith(".gz")) {
    const tempPlainPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath, ".gz")}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await writeDatasetJson(tempPlainPath, dataset);
      const plain = await fs.readFile(tempPlainPath, "utf8");
      const compressed = gzipSync(plain, { level: 9 });
      await writeFileAtomic(filePath, compressed);
    } finally {
      await fs.rm(tempPlainPath, { force: true }).catch(() => undefined);
    }
    return;
  }
  await writeDatasetJson(filePath, dataset);
}

export async function readLineDelimitedDataset(filePath) {
  const dataset = {};
  const wantedArrays = new Set([
    "resources",
    "recipes",
    "recipeMaps",
    "recipeMapIcons",
    "machineHandlerIcons",
    "resourceIndex",
    "plantSourceKeys",
  ]);
  let currentArrayKey;
  let skippingArray = false;
  let currentObjectKey;
  let objectLines;
  let objectDepth;

  const lines = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "{" || line === "}") {
      continue;
    }

    if (currentObjectKey) {
      objectLines.push(line);
      objectDepth += bracesDelta(line);
      if (objectDepth > 0) {
        continue;
      }
      dataset[currentObjectKey] = parseStreamedObject(objectLines, currentObjectKey);
      currentObjectKey = undefined;
      objectLines = undefined;
      continue;
    }

    if (currentArrayKey || skippingArray) {
      if (line === "]," || line === "]") {
        currentArrayKey = undefined;
        skippingArray = false;
        continue;
      }

      if (currentArrayKey) {
        dataset[currentArrayKey].push(parseJsonLineValue(line));
      }
      continue;
    }

    const match = /^("(?:(?:\\.)|[^"\\])*"):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = JSON.parse(match[1]);
    const value = match[2].replace(/,$/, "");
    if (value === "[") {
      if (wantedArrays.has(key)) {
        dataset[key] = [];
        currentArrayKey = key;
      } else {
        skippingArray = true;
      }
      continue;
    }

    if (value === "{") {
      currentObjectKey = key;
      objectLines = [];
      objectDepth = 1;
      continue;
    }

    dataset[key] = JSON.parse(value);
  }

  return dataset;
}

/**
 * Rebuild a streamed object from its captured lines. `objectLines` are the
 * key lines (each ending with a comma, except when they were the final
 * property of the file) plus the closing `}`/`},` line.
 */
function parseStreamedObject(objectLines, key) {
  const closing = objectLines.at(-1);
  if (closing !== "}" && closing !== "},") {
    throw new Error(`Unterminated streamed dataset key "${key}".`);
  }

  try {
    const keyLines = objectLines.slice(0, -1).join("\n").replace(/,\s*$/, "");
    return JSON.parse(`{\n${keyLines}\n}`);
  } catch (error) {
    throw new Error(
      `Could not parse streamed dataset key "${key}" from its ${objectLines.length} lines: ${error.message}`,
    );
  }
}

/** A streamed-object capture only sees its key lines and a closing `}`/`},`. */
function bracesDelta(line) {
  if (line === "}" || line === "},") return -1;
  return 0;
}

function parseJsonLineValue(line) {
  return JSON.parse(line.replace(/,$/, ""));
}
