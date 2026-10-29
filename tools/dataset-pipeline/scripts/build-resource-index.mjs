import { readDatasetFile, writeDatasetFile } from "../lib/line-dataset.mjs";

const datasetPath = process.argv[2];

if (!datasetPath) {
  throw new Error("Usage: build-resource-index.mjs <recipes.json|recipes.json.gz>");
}

const dataset = await readDatasetFile(datasetPath);
dataset.resourceIndex = buildResourceIndex(dataset);
await writeDatasetFile(datasetPath, dataset);

console.log(`Wrote resourceIndex with ${dataset.resourceIndex.length} resources.`);


function buildResourceIndex(dataset) {
  const resourcesByKey = new Map(
    (dataset.resources ?? []).map((resource) => [resourceKey(resource), resource]),
  );
  const index = new Map();

  for (const recipe of dataset.recipes ?? []) {
    for (const resource of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
      const key = resourceKey(resource);
      const existing = index.get(key);
      if (existing) {
        existing.recipeCount += 1;
        mergeResourceIcon(existing, resource, resourcesByKey.get(key));
        continue;
      }

      const indexed = resourcesByKey.get(key);
      index.set(key, {
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName ?? indexed?.displayName,
        iconPath: currentIconPath(resource.iconPath, indexed?.iconPath),
        iconAtlas: indexed?.iconAtlas ?? resource.iconAtlas,
        dominantColor:
          indexed?.dominantColor ??
          resource.dominantColor ??
          indexed?.iconAtlas?.dominantColor ??
          resource.iconAtlas?.dominantColor,
        recipeCount: 1,
        tooltip: resource.tooltip ?? indexed?.tooltip,
        oreDictionary: resource.oreDictionary ?? indexed?.oreDictionary,
        alternatives: resource.alternatives ?? indexed?.alternatives,
      });
    }
  }

  return [...index.values()].sort((left, right) => right.recipeCount - left.recipeCount);
}

function mergeResourceIcon(target, resource, indexed) {
  if (!target.displayName) {
    target.displayName = resource.displayName ?? indexed?.displayName;
  }
  if (!target.iconPath) {
    target.iconPath = currentIconPath(resource.iconPath, indexed?.iconPath);
  }
  if (!target.iconAtlas) {
    target.iconAtlas = indexed?.iconAtlas ?? resource.iconAtlas;
  }
  if (!target.dominantColor) {
    target.dominantColor =
      indexed?.dominantColor ??
      resource.dominantColor ??
      indexed?.iconAtlas?.dominantColor ??
      resource.iconAtlas?.dominantColor;
  }
  if (!target.oreDictionary) {
    target.oreDictionary = resource.oreDictionary ?? indexed?.oreDictionary;
  }
  if (!target.tooltip) {
    target.tooltip = resource.tooltip ?? indexed?.tooltip;
  }
  if (!target.alternatives) {
    target.alternatives = resource.alternatives ?? indexed?.alternatives;
  }
}

function currentIconPath(resourceIconPath, indexedIconPath) {
  if (isLegacyRenderedIconPath(resourceIconPath)) {
    return indexedIconPath;
  }

  return indexedIconPath ?? resourceIconPath;
}

function isLegacyRenderedIconPath(iconPath) {
  return typeof iconPath === "string" && iconPath.includes("/textures/rendered/");
}

function resourceKey(resource) {
  return `${resource.kind}:${resource.id}`;
}
