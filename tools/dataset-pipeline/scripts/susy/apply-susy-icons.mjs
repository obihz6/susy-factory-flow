/**
 * Applies rendered HEI icons to a normalized SUSY dataset.
 *
 * Inputs (produced by the susy-hei-oracle client export):
 *   icon-map.json       { "<registry>@<meta>#": "<file>.png" }
 *   fluid-icon-map.json { "<fluidName>#":     "<file>.png" }
 *
 * Copies matched PNGs into <dataset-dir>/textures/rendered/ and stamps each
 * dataset resource with an iconPath under DATASETS_URL_ROOT (default
 * /datasets/susy). Resources without a match simply keep no iconPath.
 *
 * Must run BEFORE build-resource-index / gzip so the stamped paths end up in
 * the published indexes.
 *
 * Usage:
 *   apply-susy-icons.mjs <recipes.json> <iconDir> <datasetDir> [urlRoot]
 */
import fs from "node:fs/promises";
import path from "node:path";

const [recipesPath, iconDir, datasetDir, urlRoot = "/datasets/susy"] = process.argv.slice(2);
if (!recipesPath || !iconDir || !datasetDir) {
  throw new Error(
    "Usage: apply-susy-icons.mjs <recipes.json> <iconDir> <datasetDir> [urlRoot]",
  );
}

const dataset = await readPlainJson(recipesPath);
const versionId = dataset.datasetVersionId;
if (!versionId) throw new Error("Dataset is missing datasetVersionId.");

const itemMap = normalizeMap(JSON.parse(await fs.readFile(path.join(iconDir, "icon-map.json"), "utf8")));
const fluidMap = normalizeMap(
  JSON.parse(await fs.readFile(path.join(iconDir, "fluid-icon-map.json"), "utf8")),
);

/** Keys look like "<id>#" or "<registry>@<meta>#"; index them case-insensitively. */
function normalizeMap(raw) {
  const map = new Map();
  for (const [key, file] of Object.entries(raw)) {
    const cleanKey = key.replace(/#.*$/, "").toLowerCase();
    if (!map.has(cleanKey)) map.set(cleanKey, file);
  }
  return map;
}

const texturesDir = path.join(datasetDir, "textures", "rendered");
await fs.mkdir(texturesDir, { recursive: true });

let copied = 0;
let itemsMatched = 0;
let fluidsMatched = 0;

for (const resource of dataset.resources ?? []) {
  const base = resource.id.toLowerCase();
  // Item map keys always carry an explicit meta ("registry@0#"); try the bare
  // id first for fluids and meta-carrying items, then the implicit meta 0.
  const file =
    resource.kind === "fluid"
      ? fluidMap.get(base)
      : itemMap.get(base) ?? itemMap.get(`${base}@0`);
  if (!file) continue;

  const source = path.join(iconDir, file);
  const target = path.join(texturesDir, file);
  try {
    await fs.copyFile(source, target);
    copied += 1;
  } catch {
    continue;
  }
  resource.iconPath = `${urlRoot}/${versionId}/textures/rendered/${file}`;
  if (resource.kind === "fluid") fluidsMatched += 1;
  else itemsMatched += 1;
}

// Recipe-level resources reference catalog entries by id; stamp any recipe
// input/output that still lacks an icon from its catalog entry.
const iconById = new Map(
  (dataset.resources ?? [])
    .filter((resource) => resource.iconPath)
    .map((resource) => [`${resource.kind}:${resource.id}`, resource.iconPath]),
);
let recipeSlotsStamped = 0;
for (const recipe of dataset.recipes ?? []) {
  for (const slot of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
    const iconPath = iconById.get(`${slot.kind}:${slot.id}`);
    if (iconPath && !slot.iconPath) {
      slot.iconPath = iconPath;
      recipeSlotsStamped += 1;
    }
  }
}

// Category faces (recipe maps) and machine-selector entries carry their own
// machine-item resources; give them the same treatment as catalog entries.
let machineFacesStamped = 0;
for (const entry of [
  ...(dataset.recipeMapIcons ?? []),
  ...(dataset.machineHandlerIcons ?? []),
]) {
  const resource = entry.resource;
  if (!resource) continue;
  const base = resource.id.toLowerCase();
  const file =
    resource.kind === "fluid"
      ? fluidMap.get(base)
      : itemMap.get(base) ?? itemMap.get(`${base}@0`);
  if (!file) continue;
  const source = path.join(iconDir, file);
  const target = path.join(texturesDir, file);
  try {
    await fs.copyFile(source, target);
  } catch {
    continue;
  }
  resource.iconPath = `${urlRoot}/${versionId}/textures/rendered/${file}`;
  machineFacesStamped += 1;
}

await writePlainJson(recipesPath, dataset);

console.log(
  `Icons applied: ${itemsMatched} items, ${fluidsMatched} fluids (${copied} files copied, ` +
    `${recipeSlotsStamped} recipe slots stamped, ${machineFacesStamped} machine/category faces stamped).`,
);

async function readPlainJson(filePath) {
  const { createReadStream } = await import("node:fs");
  const readline = await import("node:readline");
  const text = await fs.readFile(filePath.endsWith(".gz") ? `${filePath}` : filePath, "utf8");
  void createReadStream;
  void readline;
  return JSON.parse(text);
}

async function writePlainJson(filePath, dataset) {
  const { writeDatasetJson } = await import("../dataset-json-writer.mjs");
  // Keep the line-oriented format rebuild-manifest's parser depends on.
  await writeDatasetJson(filePath, dataset);
}
