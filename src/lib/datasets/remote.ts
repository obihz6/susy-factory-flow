import { parseDatasetManifestJson, parseRecipeDatasetJson } from "../import-export";
import { DEFAULT_DATASET_MANIFEST_URL } from "../pack";
import type { DatasetManifest, DatasetVersion, RecipeDataset } from "./types";

export { DEFAULT_DATASET_MANIFEST_URL };

export async function fetchDatasetManifest(
  manifestUrl = DEFAULT_DATASET_MANIFEST_URL,
): Promise<DatasetManifest> {
  const response = await fetch(withCacheBust(manifestUrl), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load dataset manifest (${response.status}).`);
  }

  return parseDatasetManifestJson(await response.text());
}

export async function fetchRecipeDatasetVersion(
  manifestUrl: string,
  version: DatasetVersion,
): Promise<RecipeDataset> {
  const datasetUrl = resolveDatasetUrl(manifestUrl, version.recipeDatasetPath);
  const response = await fetch(datasetUrl, {
    cache: "force-cache",
    headers: {
      Accept: "application/json, application/gzip, application/octet-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load dataset ${version.id} (${response.status}).`);
  }

  const dataset = parseRecipeDatasetJson(await readDatasetResponseText(response, datasetUrl));

  if (dataset.datasetVersionId !== version.id) {
    throw new Error(
      `Dataset id mismatch: manifest expected ${version.id}, file contains ${dataset.datasetVersionId}.`,
    );
  }

  return dataset;
}

export function pickDefaultDatasetVersion(manifest: DatasetManifest): DatasetVersion | undefined {
  const preferredId = manifest.latestStableVersion ?? manifest.latestDailyVersion;
  if (preferredId) {
    return manifest.versions.find((version) => version.id === preferredId);
  }

  return manifest.versions[0];
}

export function resolveDatasetUrl(manifestUrl: string, datasetPath: string): string {
  if (/^https?:\/\//i.test(datasetPath) || datasetPath.startsWith("/")) {
    return datasetPath;
  }

  return new URL(datasetPath, new URL(manifestUrl, window.location.origin)).toString();
}

async function readDatasetResponseText(response: Response, datasetUrl: string): Promise<string> {
  if (!datasetUrl.endsWith(".gz")) {
    return response.text();
  }

  if (!response.body || !("DecompressionStream" in globalThis)) {
    throw new Error("This browser cannot decompress GTNH dataset files.");
  }

  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function withCacheBust(url: string): string {
  const resolvedUrl = new URL(url, window.location.origin);
  resolvedUrl.searchParams.set("t", String(Date.now()));
  return resolvedUrl.toString();
}
