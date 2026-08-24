import { parseDatasetManifestJson, parseRecipeDatasetJson } from "../import-export";
import type { DatasetManifest, DatasetVersion, RecipeDataset } from "./types";

export const DEFAULT_DATASET_MANIFEST_URL =
  process.env.NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL ?? "/datasets/gtnh/datasets.manifest.json";

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

/**
 * 2.8.4 is temporarily withdrawn from the picker (2026-08-23): everyone plays
 * on 2.9 betas and the manifest's order cannot be trusted to keep 2.9 first.
 * Delete the entry to offer it again.
 */
export const HIDDEN_DATASET_VERSION_IDS = new Set(["local-2.8.4"]);

export function listSelectableDatasetVersions(manifest: DatasetManifest): DatasetVersion[] {
  const selectable = manifest.versions.filter(
    (version) => !HIDDEN_DATASET_VERSION_IDS.has(version.id),
  );
  // A manifest holding only hidden versions still needs to offer something.
  return selectable.length > 0 ? selectable : manifest.versions;
}

export function pickDefaultDatasetVersion(manifest: DatasetManifest): DatasetVersion | undefined {
  const selectable = listSelectableDatasetVersions(manifest);
  const preferredId = manifest.latestStableVersion ?? manifest.latestDailyVersion;
  if (preferredId) {
    const preferred = selectable.find((version) => version.id === preferredId);
    if (preferred) {
      return preferred;
    }
  }

  return selectable[0];
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
